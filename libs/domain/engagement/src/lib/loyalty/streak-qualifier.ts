import { Result, fail, ok } from '@creativo/domain/kernel';
import type { ServiceCategoryId, ServiceId } from '@creativo/domain/catalog';
import {
  StreakDefinitionError,
  StreakQualifierEmptyError,
  StreakUnknownOptionError,
} from './streak-definition.errors';

/**
 * Which visit keeps the rhythm (client-card revision 3 §4.1, P2): any
 * worked visit, or one that holds a chosen service, or a service of a
 * chosen category.
 */
export type StreakQualifierProps =
  | { kind: 'anyVisit' }
  | { kind: 'services'; serviceIds: readonly string[] }
  | { kind: 'categories'; categoryIds: readonly string[] };

export const STREAK_QUALIFIER_KINDS = [
  'anyVisit',
  'services',
  'categories',
] as const;

/**
 * One person's worked seats in one visit, as the qualifier reads them: the
 * services done, the categories those services sit in, and which of the
 * services only ever ride along with another (`Service.upsellOnly`).
 */
export interface StreakQualifierVisit {
  readonly serviceIds: readonly ServiceId[];
  readonly categoryIds: readonly ServiceCategoryId[];
  readonly upsellOnlyIds: readonly ServiceId[];
}

function chosen(raw: readonly string[]): readonly string[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const ids: string[] = [];
  for (const id of raw) {
    if (typeof id !== 'string' || id.trim().length === 0) return null;
    // A name said twice is said once: the choice is a set.
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * The qualifier as a value. A list names at least one id and no blank one;
 * the order the admin chose is kept for the page, the comparison is a
 * set's.
 */
export class StreakQualifier {
  private readonly ids: ReadonlySet<string>;

  private constructor(private readonly props: StreakQualifierProps) {
    this.ids = new Set(
      props.kind === 'services'
        ? props.serviceIds
        : props.kind === 'categories'
          ? props.categoryIds
          : [],
    );
  }

  static create(
    props: StreakQualifierProps,
  ): Result<StreakQualifier, StreakDefinitionError[]> {
    switch (props.kind) {
      case 'anyVisit':
        return ok(new StreakQualifier({ kind: 'anyVisit' }));
      case 'services': {
        const serviceIds = chosen(props.serviceIds);
        return serviceIds === null
          ? fail([
              new StreakQualifierEmptyError(
                'qualifier.serviceIds',
                props.serviceIds,
              ),
            ])
          : ok(new StreakQualifier({ kind: 'services', serviceIds }));
      }
      case 'categories': {
        const categoryIds = chosen(props.categoryIds);
        return categoryIds === null
          ? fail([
              new StreakQualifierEmptyError(
                'qualifier.categoryIds',
                props.categoryIds,
              ),
            ])
          : ok(new StreakQualifier({ kind: 'categories', categoryIds }));
      }
      default:
        return fail([
          new StreakUnknownOptionError(
            'qualifier.kind',
            (props as { kind?: unknown }).kind,
            STREAK_QUALIFIER_KINDS,
          ),
        ]);
    }
  }

  get kind(): StreakQualifierProps['kind'] {
    return this.props.kind;
  }

  /**
   * Does this visit keep the rhythm? It must hold a service of its own: one
   * that only rides along with another never counts alone, under any
   * qualifier. With a list, one of the visit's services (or of their
   * categories) must be on it.
   */
  counts(visit: StreakQualifierVisit): boolean {
    const rideAlong = new Set(visit.upsellOnlyIds.map((id) => id.value));
    if (!visit.serviceIds.some((id) => !rideAlong.has(id.value))) return false;
    switch (this.props.kind) {
      case 'anyVisit':
        return true;
      case 'services':
        return visit.serviceIds.some((id) => this.ids.has(id.value));
      case 'categories':
        return visit.categoryIds.some((id) => this.ids.has(id.value));
    }
  }

  /**
   * How this qualifier stands to the one before it: `wider` counts every
   * visit the other counted and more, `narrower` the reverse, `other`
   * neither (two lists that only overlap, services against categories).
   */
  comparedTo(
    previous: StreakQualifier,
  ): 'same' | 'wider' | 'narrower' | 'other' {
    const now = this.props.kind;
    const before = previous.props.kind;
    if (now === 'anyVisit' || before === 'anyVisit') {
      if (now === before) return 'same';
      return now === 'anyVisit' ? 'wider' : 'narrower';
    }
    if (now !== before) return 'other';
    const keepsAll = [...previous.ids].every((id) => this.ids.has(id));
    const addsNone = [...this.ids].every((id) => previous.ids.has(id));
    if (keepsAll && addsNone) return 'same';
    if (keepsAll) return 'wider';
    return addsNone ? 'narrower' : 'other';
  }

  equals(other: StreakQualifier): boolean {
    return this.comparedTo(other) === 'same';
  }

  /** A fresh copy: what the document and the editor's draft hold. */
  toProps(): StreakQualifierProps {
    const props = this.props;
    switch (props.kind) {
      case 'anyVisit':
        return { kind: 'anyVisit' };
      case 'services':
        return { kind: 'services', serviceIds: [...props.serviceIds] };
      case 'categories':
        return { kind: 'categories', categoryIds: [...props.categoryIds] };
    }
  }
}
