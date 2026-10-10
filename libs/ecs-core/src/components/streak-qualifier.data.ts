import type { ServiceCategoryId } from '../entities/service-category.entity';
import type { ServiceId } from '../entities/service.entity';
import {
  EngagementError,
  EngagementErrorCode,
  StreakRuleField,
} from './engagement-errors.data';
import { Result } from './result.data';

/** Which visit keeps the rhythm, by kind — the stored tags, unchanged. */
export const StreakQualifierKind = {
  AnyVisit: 'anyVisit',
  Services: 'services',
  Categories: 'categories',
} as const;
export type StreakQualifierKind =
  (typeof StreakQualifierKind)[keyof typeof StreakQualifierKind];

/**
 * How a qualifier stands to the one before it: `wider` counts every visit
 * the other counted and more, `narrower` the reverse, `other` neither (two
 * lists that only overlap, services against categories).
 */
export const QualifierComparison = {
  Same: 'same',
  Wider: 'wider',
  Narrower: 'narrower',
  Other: 'other',
} as const;
export type QualifierComparison =
  (typeof QualifierComparison)[keyof typeof QualifierComparison];

const STREAK_QUALIFIER_KINDS: readonly StreakQualifierKind[] =
  Object.values(StreakQualifierKind);

/**
 * Which visit keeps the rhythm (client-card revision 3 §4.1, P2): any
 * worked visit, or one that holds a chosen service, or a service of a
 * chosen category (`streak-qualifier.ts`). A list names at least one id and
 * no blank one; the order the admin chose is kept for the page, the
 * comparison is a set's.
 */
export type StreakQualifier =
  | StreakQualifier.AnyVisit
  | StreakQualifier.Services
  | StreakQualifier.Categories;

export const StreakQualifier = {
  anyVisit(): StreakQualifier.AnyVisit {
    return { kind: StreakQualifierKind.AnyVisit };
  },

  services(serviceIds: readonly ServiceId[]): StreakQualifier.Services {
    return { kind: StreakQualifierKind.Services, serviceIds };
  },

  categories(
    categoryIds: readonly ServiceCategoryId[],
  ): StreakQualifier.Categories {
    return { kind: StreakQualifierKind.Categories, categoryIds };
  },

  /**
   * The edge guard: a known kind, and a list of at least one non-blank id —
   * a name said twice is said once (the choice is a set; first position
   * kept). Returns a fresh struct.
   */
  parse(
    raw: StreakQualifier,
  ): Result<StreakQualifier, readonly EngagementError.StreakRuleError[]> {
    switch (raw.kind) {
      case StreakQualifierKind.AnyVisit:
        return Result.ok(StreakQualifier.anyVisit());
      case StreakQualifierKind.Services: {
        const ids = chosen(raw.serviceIds);
        return ids === null
          ? Result.err([
              emptyList(StreakRuleField.QualifierServiceIds, raw.serviceIds),
            ])
          : Result.ok(StreakQualifier.services(ids as readonly ServiceId[]));
      }
      case StreakQualifierKind.Categories: {
        const ids = chosen(raw.categoryIds);
        return ids === null
          ? Result.err([
              emptyList(StreakRuleField.QualifierCategoryIds, raw.categoryIds),
            ])
          : Result.ok(
              StreakQualifier.categories(ids as readonly ServiceCategoryId[]),
            );
      }
      default:
        return Result.err([
          EngagementError.streakUnknownOption(
            StreakRuleField.QualifierKind,
            (raw as { readonly kind: unknown }).kind,
            STREAK_QUALIFIER_KINDS,
          ),
        ]);
    }
  },

  /** How `now` stands to `before` — what a rule change's direction reads. */
  compare(now: StreakQualifier, before: StreakQualifier): QualifierComparison {
    if (
      now.kind === StreakQualifierKind.AnyVisit ||
      before.kind === StreakQualifierKind.AnyVisit
    ) {
      if (now.kind === before.kind) return QualifierComparison.Same;
      return now.kind === StreakQualifierKind.AnyVisit
        ? QualifierComparison.Wider
        : QualifierComparison.Narrower;
    }
    if (now.kind !== before.kind) return QualifierComparison.Other;
    const nowIds = idsOf(now);
    const beforeIds = idsOf(before);
    const keepsAll = containsAll(nowIds, beforeIds);
    const addsNone = containsAll(beforeIds, nowIds);
    if (keepsAll && addsNone) return QualifierComparison.Same;
    if (keepsAll) return QualifierComparison.Wider;
    return addsNone ? QualifierComparison.Narrower : QualifierComparison.Other;
  },

  /** The same set of the same kind, whatever the order. */
  equals(a: StreakQualifier, b: StreakQualifier): boolean {
    return StreakQualifier.compare(a, b) === QualifierComparison.Same;
  },
} as const;

/** A list's ids, each once, or `null` when it is empty or holds a blank one. */
function chosen(raw: readonly string[]): readonly string[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const ids: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const id: unknown = raw[i];
    if (typeof id !== 'string' || id.trim().length === 0) return null;
    if (!includes(ids, id)) ids.push(id);
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
  q: StreakQualifier.Services | StreakQualifier.Categories,
): readonly string[] {
  return q.kind === StreakQualifierKind.Services ? q.serviceIds : q.categoryIds;
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

export namespace StreakQualifier {
  export type AnyVisit = { readonly kind: typeof StreakQualifierKind.AnyVisit };
  export type Services = {
    readonly kind: typeof StreakQualifierKind.Services;
    readonly serviceIds: readonly ServiceId[];
  };
  export type Categories = {
    readonly kind: typeof StreakQualifierKind.Categories;
    readonly categoryIds: readonly ServiceCategoryId[];
  };
}
