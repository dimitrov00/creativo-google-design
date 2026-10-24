import {
  type ServiceCategoryId,
  type ServiceId,
  Result,
} from '@core/primitives';
import {
  EngagementError,
  EngagementErrorCode,
  StreakRuleField,
} from '@core/errors';

/** Which visit keeps the rhythm — the rule's discriminator `streakQualifier`. */
export const StreakQualifier = {
  AnyVisit: 'ANY_VISIT',
  Services: 'SERVICES',
  Categories: 'CATEGORIES',
} as const;
export type StreakQualifier =
  (typeof StreakQualifier)[keyof typeof StreakQualifier];

/**
 * How a qualifier stands to the one before it: `WIDER` counts every visit
 * the other counted and more, `NARROWER` the reverse, `OTHER` neither (two
 * lists that only overlap, services against categories).
 */
export const QualifierComparison = {
  Same: 'SAME',
  Wider: 'WIDER',
  Narrower: 'NARROWER',
  Other: 'OTHER',
} as const;
export type QualifierComparison =
  (typeof QualifierComparison)[keyof typeof QualifierComparison];

const STREAK_QUALIFIERS: readonly StreakQualifier[] =
  Object.values(StreakQualifier);

/**
 * Which visit keeps the rhythm (client-card revision 3 §4.1, P2): any
 * worked visit, or one that holds a chosen service, or a service of a
 * chosen category (`streak-qualifier.ts`) — a variant SLICE of the flat
 * `StreakRule`, discriminated by `streakQualifier`, its lists prefixed
 * `qualifier`. A list names at least one id and no blank one; the order the
 * admin chose is kept for the page, the comparison is a set's.
 */
export type StreakQualifierRule =
  | StreakQualifierRule.AnyVisit
  | StreakQualifierRule.Services
  | StreakQualifierRule.Categories;

export const StreakQualifierRule = {
  anyVisit(): StreakQualifierRule.AnyVisit {
    return { streakQualifier: StreakQualifier.AnyVisit };
  },

  services(
    qualifierServiceIds: readonly ServiceId[],
  ): StreakQualifierRule.Services {
    return { streakQualifier: StreakQualifier.Services, qualifierServiceIds };
  },

  categories(
    qualifierCategoryIds: readonly ServiceCategoryId[],
  ): StreakQualifierRule.Categories {
    return {
      streakQualifier: StreakQualifier.Categories,
      qualifierCategoryIds,
    };
  },

  /**
   * The qualifier fields of a rule (or of any struct carrying the slice),
   * as a fresh slice of their own — the lists copied, never shared.
   */
  of(qualifier: StreakQualifierRule): StreakQualifierRule {
    switch (qualifier.streakQualifier) {
      case StreakQualifier.Services:
        return StreakQualifierRule.services([...qualifier.qualifierServiceIds]);
      case StreakQualifier.Categories:
        return StreakQualifierRule.categories([
          ...qualifier.qualifierCategoryIds,
        ]);
      default:
        return StreakQualifierRule.anyVisit();
    }
  },

  /**
   * The edge guard: a known qualifier, and a list of at least one non-blank
   * id — a name said twice is said once (the choice is a set; first position
   * kept). Returns a fresh slice.
   */
  parse(
    raw: StreakQualifierRule,
  ): Result<StreakQualifierRule, readonly EngagementError.StreakRuleError[]> {
    switch (raw.streakQualifier) {
      case StreakQualifier.AnyVisit:
        return Result.ok(StreakQualifierRule.anyVisit());
      case StreakQualifier.Services: {
        const ids = chosen(raw.qualifierServiceIds);
        return ids === null
          ? Result.err([
              emptyList(
                StreakRuleField.QualifierServiceIds,
                raw.qualifierServiceIds,
              ),
            ])
          : Result.ok(StreakQualifierRule.services(ids));
      }
      case StreakQualifier.Categories: {
        const ids = chosen(raw.qualifierCategoryIds);
        return ids === null
          ? Result.err([
              emptyList(
                StreakRuleField.QualifierCategoryIds,
                raw.qualifierCategoryIds,
              ),
            ])
          : Result.ok(StreakQualifierRule.categories(ids));
      }
      default:
        return Result.err([
          EngagementError.streakUnknownOption(
            StreakRuleField.QualifierKind,
            (raw as { readonly streakQualifier: unknown }).streakQualifier,
            STREAK_QUALIFIERS,
          ),
        ]);
    }
  },

  /** How `now` stands to `before` — what a rule change's direction reads. */
  compare(
    now: StreakQualifierRule,
    before: StreakQualifierRule,
  ): QualifierComparison {
    if (
      now.streakQualifier === StreakQualifier.AnyVisit ||
      before.streakQualifier === StreakQualifier.AnyVisit
    ) {
      if (now.streakQualifier === before.streakQualifier) {
        return QualifierComparison.Same;
      }
      return now.streakQualifier === StreakQualifier.AnyVisit
        ? QualifierComparison.Wider
        : QualifierComparison.Narrower;
    }
    if (now.streakQualifier !== before.streakQualifier) {
      return QualifierComparison.Other;
    }
    const nowIds = idsOf(now);
    const beforeIds = idsOf(before);
    const keepsAll = containsAll(nowIds, beforeIds);
    const addsNone = containsAll(beforeIds, nowIds);
    if (keepsAll && addsNone) return QualifierComparison.Same;
    if (keepsAll) return QualifierComparison.Wider;
    return addsNone ? QualifierComparison.Narrower : QualifierComparison.Other;
  },

  /** The same set of the same qualifier, whatever the order. */
  equals(a: StreakQualifierRule, b: StreakQualifierRule): boolean {
    return StreakQualifierRule.compare(a, b) === QualifierComparison.Same;
  },

  /**
   * A service in or out of a «Посещение с избрани услуги» list: one not
   * chosen joins at the end (the order the admin chose is kept); one chosen
   * leaves — unless it is the LAST one, which stays, because a list of
   * services names at least one (`parse`). The list handed in is never
   * written; the one kept is answered as it is.
   */
  toggleService(
    ids: readonly ServiceId[],
    id: ServiceId,
  ): readonly ServiceId[] {
    if (!includes(ids, id)) return [...ids, id];
    if (ids.length === 1) return ids;
    const out: ServiceId[] = [];
    for (let i = 0; i < ids.length; i++) {
      const other = ids[i] as ServiceId;
      if (other !== id) out.push(other);
    }
    return out;
  },
} as const;

/** A list's ids, each once, or `null` when it is empty or holds a blank one. */
function chosen<T extends string>(raw: readonly T[]): readonly T[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const ids: T[] = [];
  for (let i = 0; i < raw.length; i++) {
    const id: unknown = raw[i];
    if (typeof id !== 'string' || id.trim().length === 0) return null;
    if (!includes(ids, id)) ids.push(raw[i] as T);
  }
  return ids;
}

function emptyList(
  field: StreakRuleField,
  value: readonly string[],
): EngagementError.StreakBare {
  return EngagementError.streakRule(
    EngagementErrorCode.StreakQualifierEmpty,
    field,
    value,
  );
}

function idsOf(
  q: StreakQualifierRule.Services | StreakQualifierRule.Categories,
): readonly string[] {
  return q.streakQualifier === StreakQualifier.Services
    ? q.qualifierServiceIds
    : q.qualifierCategoryIds;
}

function includes(ids: readonly string[], id: string): boolean {
  for (let i = 0; i < ids.length; i++) if (ids[i] === id) return true;
  return false;
}

/** Every id of `subset` is in `set` — a linear scan; the lists are a handful long. */
function containsAll(
  set: readonly string[],
  subset: readonly string[],
): boolean {
  for (let i = 0; i < subset.length; i++) {
    if (!includes(set, subset[i] as string)) return false;
  }
  return true;
}

export namespace StreakQualifierRule {
  export type AnyVisit = {
    readonly streakQualifier: typeof StreakQualifier.AnyVisit;
  };
  export type Services = {
    readonly streakQualifier: typeof StreakQualifier.Services;
    readonly qualifierServiceIds: readonly ServiceId[];
  };
  export type Categories = {
    readonly streakQualifier: typeof StreakQualifier.Categories;
    readonly qualifierCategoryIds: readonly ServiceCategoryId[];
  };
}
