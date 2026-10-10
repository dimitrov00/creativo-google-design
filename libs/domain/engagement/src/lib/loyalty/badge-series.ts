import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  BarberId,
  LocalizedText,
  LocalizedTextProps,
  LocationId,
  ServiceId,
} from '@creativo/domain/catalog';
import {
  type BadgeLevel as SystemLevel,
  type BadgeSeriesError as SystemSeriesError,
  type BadgeSeriesShape,
  BadgeSystem,
  EngagementErrorCode,
  type Metric as SystemMetric,
} from '@creativo/ecs-core';
import { BadgeCategoryId, BadgeSeriesId, SeasonId } from '../ids';
import type {
  AwardSummary,
  BadgeEmblem,
  BadgeSubject,
  Metric,
  MetricRef,
  PerkId,
} from './badge-vocabulary';
import {
  BadgeSeriesAwardNotPositiveError,
  BadgeSeriesError,
  BadgeSeriesHomelessError,
  BadgeSeriesLevelGapError,
  BadgeSeriesLevelWithoutRuleError,
  BadgeSeriesNoLevelsError,
  BadgeSeriesOneOffWithSeveralLevelsError,
  BadgeSeriesRepeatableWithSeveralLevelsError,
  BadgeSeriesTargetsNotRisingError,
} from './badge-series.errors';
import type { BadgeProgress } from './projections';

/**
 * One level of a family, drawn «I»…«V». Each level is its own once-rule
 * under its own award key, so a summary counts LEVELS and a level never
 * pays twice. A value inside the family: {@link BadgeSeries.create} checks
 * the levels together.
 */
export interface BadgeLevel {
  /** 1-based, drawn as a numeral. */
  readonly level: number;
  /** The once-rule that awards this level. */
  readonly ruleId: string;
  /** On the family's metric; `null` = a one-off act, then the family's only level. */
  readonly target: number | null;
  /** «25 посещения с фейд» */
  readonly requirement: LocalizedText;
  /** `[]` = recognition only. */
  readonly awards: readonly AwardSummary[];
}

/** A family for one client (§4.2). */
export type MedalState = 'notStarted' | 'inProgress' | 'earned';

/**
 * A family for one client: the rim numeral is `highestLevel` (0 = none, no
 * numeral), the caption `value` / `target`.
 */
export interface SeriesStanding {
  /** `earned` = at least one level. */
  readonly state: MedalState;
  readonly highestLevel: number;
  /** `null` = complete — a yearly family once earned, too. */
  readonly next: BadgeLevel | null;
  readonly value: number;
  readonly target: number | null;
}

export type AwardSummaryProps =
  | { kind: 'points'; points: number }
  | { kind: 'coupon'; title: LocalizedTextProps }
  | { kind: 'freeze'; count: number }
  | { kind: 'perk'; perkId: PerkId; forDays: number | null };

export interface BadgeLevelProps {
  level: number;
  ruleId: string;
  target: number | null;
  requirement: LocalizedTextProps;
  awards: readonly AwardSummaryProps[];
}

export type BadgeSubjectProps =
  | { kind: 'service'; serviceId: string }
  | { kind: 'barber'; barberId: string }
  | { kind: 'location'; locationId: string };

export interface MetricRefProps {
  metric: Metric;
  window?: { lastDays: number };
  where?: { serviceId?: string; barberId?: string; locationId?: string };
}

export interface BadgeSeriesProps {
  id: string;
  categoryId: string | null;
  seasonId: string | null;
  title: LocalizedTextProps;
  requirement: LocalizedTextProps;
  emblem: BadgeEmblem;
  subject: BadgeSubjectProps | null;
  /** `null` for a one-off act, and for the rhythm family, whose value is the cadence streak's best run. */
  metric: MetricRefProps | null;
  art: { path: string } | null;
  levels: readonly BadgeLevelProps[];
  repeatable: boolean;
  order: number;
  retiredAt: Date | null;
  version: number;
}

/**
 * `badgeSeries/{id}` — ONE medal family, the unit the card draws: «Фейд»
 * I…V, «С Иван», «Добре дошъл». It lives in a category or in a season.
 *
 * The family, not the level, is what the page shows and counts: its
 * standing for a client is derived from that client's progress document
 * (absent = not started) by {@link standing}, so the glance, the shelves and
 * the detail page can never disagree about it.
 */
export class BadgeSeries {
  private constructor(
    readonly id: BadgeSeriesId,
    readonly categoryId: BadgeCategoryId | null,
    readonly seasonId: SeasonId | null,
    /** «Фейд» */
    readonly title: LocalizedText,
    /** The family's sentence without a figure: «Посещения с фейд». */
    readonly requirement: LocalizedText,
    readonly emblem: BadgeEmblem,
    readonly subject: BadgeSubject | null,
    readonly metric: MetricRef | null,
    /** Owner art in Storage: wins over the subject's art and the emblem. */
    readonly art: { readonly path: string } | null,
    readonly levels: readonly BadgeLevel[],
    /** Earned again every year (the birthday visit). */
    readonly repeatable: boolean,
    readonly order: number,
    readonly retiredAt: Date | null,
    readonly version: number,
  ) {}

  static create(
    props: BadgeSeriesProps,
  ): Result<BadgeSeries, BadgeSeriesError[]> {
    const errors: BadgeSeriesError[] = [];
    const collect = <T>(
      result: Result<T, BadgeSeriesError | BadgeSeriesError[]>,
    ): T | null => {
      if (result.isSuccess()) return result.value;
      errors.push(
        ...(Array.isArray(result.error) ? result.error : [result.error]),
      );
      return null;
    };

    const id = collect(BadgeSeriesId.create(props.id));
    const categoryId =
      props.categoryId === null
        ? null
        : collect(BadgeCategoryId.create(props.categoryId));
    const seasonId =
      props.seasonId === null ? null : collect(SeasonId.create(props.seasonId));
    const title = collect(LocalizedText.create(props.title));
    const requirement = collect(LocalizedText.create(props.requirement));
    const subject =
      props.subject === null ? null : collect(subjectOf(props.subject));
    const metric =
      props.metric === null ? null : collect(metricRefOf(props.metric));
    const levels = props.levels.map((level) => collect(levelOf(level)));
    errors.push(...shapeProblems(props));

    if (
      errors.length > 0 ||
      id === null ||
      title === null ||
      requirement === null
    ) {
      return fail(errors);
    }
    return ok(
      new BadgeSeries(
        id,
        categoryId,
        seasonId,
        title,
        requirement,
        props.emblem,
        subject,
        metric,
        props.art === null ? null : { path: props.art.path },
        levels.filter((level): level is BadgeLevel => level !== null),
        props.repeatable,
        props.order,
        props.retiredAt,
        props.version,
      ),
    );
  }

  /**
   * Where this family stands for one client. `progress` is the client's
   * document for it, `null` when they have none (not started). A complete
   * family has no `next`; a yearly one is complete once earned.
   */
  standing(progress: BadgeProgress | null): SeriesStanding {
    const standing = BadgeSystem.standing(
      levelsOf(this),
      progress === null
        ? null
        : {
            value: progress.value,
            earned: progress.earned.map((earned) => ({
              level: earned.level,
              earnedAtMs: earned.earnedAt.getTime(),
              via: earned.via,
              count: earned.count,
            })),
          },
    );
    // The system hands back one of this family's own levels, by reference.
    return { ...standing, next: standing.next as BadgeLevel | null };
  }

  /** Withdrawn from the catalogue: shown only where a client already started it. */
  isRetired(): boolean {
    return BadgeSystem.isRetired({
      retiredAtMs: this.retiredAt === null ? null : this.retiredAt.getTime(),
    });
  }

  /** Tenure: nothing a visit does moves it, so it never sits in «Скоро». */
  isCalendarDriven(): boolean {
    return BadgeSystem.isCalendarDriven({
      metric:
        this.metric === null
          ? null
          : {
              metric: this.metric.metric as SystemMetric,
              window: null,
              where: null,
            },
    });
  }

  levelAt(level: number): BadgeLevel | null {
    return BadgeSystem.levelAt(levelsOf(this), level) as BadgeLevel | null;
  }
}

/** The checks over the levels together, and the family's home: `BadgeSystem.shapeProblems`. */
function shapeProblems(props: BadgeSeriesProps): BadgeSeriesError[] {
  return BadgeSystem.shapeProblems(shapeOf(props)).map((error) =>
    legacyErrorOf(error, props),
  );
}

function levelOf(
  props: BadgeLevelProps,
): Result<BadgeLevel, BadgeSeriesError[]> {
  // The level's own rules (`BadgeSystem.levelProblems`), then its words.
  const errors: BadgeSeriesError[] = BadgeSystem.levelProblems(
    levelOfProps(props),
  ).map((error) => legacyErrorOf(error, null));
  const requirement = LocalizedText.create(props.requirement);
  if (requirement.isFailure()) errors.push(...requirement.error);
  const awards: AwardSummary[] = [];
  for (const award of props.awards) {
    const parsed = awardOf(award);
    if (parsed.isFailure()) errors.push(...parsed.error);
    else if (parsed.value !== null) awards.push(parsed.value);
  }
  if (errors.length > 0 || requirement.isFailure()) return fail(errors);
  return ok({
    level: props.level,
    ruleId: props.ruleId,
    target: props.target,
    requirement: requirement.value,
    awards,
  });
}

/**
 * One award as the level pays it. Its figures were judged by
 * `BadgeSystem.levelProblems` (a refused one is `null`); a coupon's title is
 * the edge's to guard.
 */
function awardOf(
  props: AwardSummaryProps,
): Result<AwardSummary | null, BadgeSeriesError[]> {
  switch (props.kind) {
    case 'points':
      return ok(
        positiveWhole(props.points)
          ? { kind: 'points', points: props.points }
          : null,
      );
    case 'freeze':
      return ok(
        positiveWhole(props.count)
          ? { kind: 'freeze', count: props.count }
          : null,
      );
    case 'perk':
      return ok(
        props.forDays === null || positiveWhole(props.forDays)
          ? { kind: 'perk', perkId: props.perkId, forDays: props.forDays }
          : null,
      );
    case 'coupon': {
      const title = LocalizedText.create(props.title);
      return title.isSuccess()
        ? ok({ kind: 'coupon', title: title.value })
        : fail(title.error);
    }
  }
}

const positiveWhole = (n: number): boolean => Number.isInteger(n) && n > 0;

function subjectOf(
  props: BadgeSubjectProps,
): Result<BadgeSubject, BadgeSeriesError> {
  switch (props.kind) {
    case 'service': {
      const id = ServiceId.create(props.serviceId);
      return id.isSuccess()
        ? ok({ kind: 'service', serviceId: id.value })
        : fail(id.error);
    }
    case 'barber': {
      const id = BarberId.create(props.barberId);
      return id.isSuccess()
        ? ok({ kind: 'barber', barberId: id.value })
        : fail(id.error);
    }
    case 'location': {
      const id = LocationId.create(props.locationId);
      return id.isSuccess()
        ? ok({ kind: 'location', locationId: id.value })
        : fail(id.error);
    }
  }
}

function metricRefOf(
  props: MetricRefProps,
): Result<MetricRef, BadgeSeriesError[]> {
  const errors: BadgeSeriesError[] = [];
  const where: {
    serviceId?: ServiceId;
    barberId?: BarberId;
    locationId?: LocationId;
  } = {};
  if (props.where?.serviceId !== undefined) {
    const id = ServiceId.create(props.where.serviceId);
    if (id.isSuccess()) where.serviceId = id.value;
    else errors.push(id.error);
  }
  if (props.where?.barberId !== undefined) {
    const id = BarberId.create(props.where.barberId);
    if (id.isSuccess()) where.barberId = id.value;
    else errors.push(id.error);
  }
  if (props.where?.locationId !== undefined) {
    const id = LocationId.create(props.where.locationId);
    if (id.isSuccess()) where.locationId = id.value;
    else errors.push(id.error);
  }
  if (errors.length > 0) return fail(errors);
  return ok({
    metric: props.metric,
    ...(props.window === undefined
      ? {}
      : { window: { lastDays: props.window.lastDays } }),
    ...(props.where === undefined ? {} : { where }),
  });
}

// ── The bridge: legacy props/class ↔ ecs-core struct (Phase 4 deletes it) ──

/** A level's props as the system reads them: the same plain figures. */
function levelOfProps(props: BadgeLevelProps): SystemLevel {
  return props as unknown as SystemLevel;
}

/** The family's levels as the system reads them: the same objects, by reference. */
function levelsOf(series: BadgeSeries): {
  readonly levels: readonly SystemLevel[];
} {
  return { levels: series.levels as unknown as readonly SystemLevel[] };
}

function shapeOf(props: BadgeSeriesProps): BadgeSeriesShape {
  return {
    categoryId: props.categoryId as BadgeSeriesShape['categoryId'],
    seasonId: props.seasonId as BadgeSeriesShape['seasonId'],
    levels: props.levels.map(levelOfProps),
    repeatable: props.repeatable,
  };
}

/** The system's struct error as the class the legacy readers know; the lists from the props they were judged on. */
function legacyErrorOf(
  error: SystemSeriesError,
  props: BadgeSeriesProps | null,
): BadgeSeriesError {
  const levels = props?.levels ?? [];
  switch (error.code) {
    case EngagementErrorCode.BadgeSeriesNoLevels:
      return new BadgeSeriesNoLevelsError();
    case EngagementErrorCode.BadgeSeriesLevelGap:
      return new BadgeSeriesLevelGapError(levels.map((l) => l.level));
    case EngagementErrorCode.BadgeSeriesTargetsNotRising:
      return new BadgeSeriesTargetsNotRisingError(
        levels.flatMap((l) => (l.target === null ? [] : [l.target])),
      );
    case EngagementErrorCode.BadgeSeriesHomeless:
      return new BadgeSeriesHomelessError();
    case EngagementErrorCode.BadgeSeriesOneOffWithSeveralLevels:
      return new BadgeSeriesOneOffWithSeveralLevelsError();
    case EngagementErrorCode.BadgeSeriesRepeatableWithSeveralLevels:
      return new BadgeSeriesRepeatableWithSeveralLevelsError();
    case EngagementErrorCode.BadgeSeriesLevelWithoutRule:
      return new BadgeSeriesLevelWithoutRuleError(error.level);
    default:
      return new BadgeSeriesAwardNotPositiveError(error.level, error.kind);
  }
}
