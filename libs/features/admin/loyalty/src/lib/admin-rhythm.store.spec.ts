import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Injectable } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  type Translation,
  type TranslocoLoader,
  TranslocoService,
  provideTransloco,
} from '@jsverse/transloco';
import { NEVER, Observable, of } from 'rxjs';
import { take } from 'rxjs/operators';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CLIENT_STATS_READ_PORTS,
  CLOCK_PORTS,
  DEFAULT_LOCATION_PORTS,
  ID_PORTS,
  LOCATION_LOAD_PORTS,
  STREAK_DEFINITION_PORTS,
  STREAK_PUBLISH_PORTS,
  provideFlags,
} from '@creativo/infrastructure/firebase-app';
import { LoadState } from '@creativo/shared/view-state';
import {
  ClientStats,
  PolicyPassStamp,
  StreakExcuse,
  StreakIntervalRule,
  StreakOnBreak,
  StreakPeriodMark,
  StreakPhase,
  StreakPreviewOutcome,
  StreakPreviewUnavailable,
  StreakPublishCall,
  StreakQualifier,
  StreakQualifierRule,
  StreakRule,
  type StreakRuleInput,
  StreakRuleDirection,
  StreakRuleParameter,
  StreakTransition,
} from '@core/components';
import type { ClientStatsRecord, StreakDefinition } from '@core/entities';
import type {
  ClientStatsPagePorts,
  LocationLoadPorts,
  StreakDefinitionPorts,
  StreakPublishGatewayPorts,
} from '@core/ports';
import {
  AppointmentId,
  CustomerId,
  LocalDate,
  type MinuteOfDay,
  PublishRequestId,
  Result,
  ServiceId,
} from '@core/primitives';
import {
  RepositoryError,
  RepositoryErrorCode,
  StreakPublishError,
  StreakPublishErrorCode,
  StreakRuleField,
} from '@core/errors';
import {
  type StreakNoticePolicy,
  StreakRuleSystem,
  ZonedTimeSystem,
} from '@core/systems';
import {
  FIXTURE_TIME_ZONE,
  type StreakWorld,
  locationFixture,
  memoryClientStatsReadPorts,
  memoryDefaultLocationPorts,
  memoryLocationLoadPorts,
  memoryProgramsWorld,
  memoryStreakDefinitionPorts,
  memoryStreakPublishGatewayPorts,
  memoryStreakWorld,
  minute,
  streakDefinitionFixture,
  streakDefinitionVersionFixture,
  unwrapOk,
  utcMs,
} from '@core/testing';
import {
  ADMIN_RHYTHM_CHOICES,
  ADMIN_RHYTHM_HISTORY_LIMIT,
  ADMIN_RHYTHM_READ_TIMEOUT_MS,
  type AdminRhythmPatch,
  AdminRhythmStore,
  fixedInterval,
  patchedRhythmDraft,
  personalInterval,
} from './admin-rhythm.store';
import { type RhythmRecorder, rhythmRecorder } from './testing/rhythm-recorder';

// ── The app's own words ──────────────────────────────────────────────────

type Lang = 'bg' | 'en';

function catalogue(lang: Lang): Translation {
  return JSON.parse(
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed path to the app's own catalogue.
    readFileSync(
      resolve(
        __dirname,
        `../../../../../infrastructure/i18n/src/assets/i18n/${lang}.json`,
      ),
      'utf8',
    ),
  ) as Translation;
}

@Injectable()
class CatalogueLoader implements TranslocoLoader {
  getTranslation(lang: string): Observable<Translation> {
    return of(catalogue(lang === 'en' ? 'en' : 'bg'));
  }
}

// ── The shop's day ───────────────────────────────────────────────────────

/** Monday 28 September 2026, 12:40 in Sofia: the fixtures' day. */
const NOW = '2026-09-28T12:40:00';
const TODAY = '2026-09-28';
const TOMORROW = '2026-09-29';
const FIRST_OF_MONTH = '2026-10-01';

/** A shop day the fixtures name, branded. */
const day = (raw: string): LocalDate => unwrapOk(LocalDate.parse(raw));

/** A visit on the shop's wall clock — the day and minute the statistics hold (Law 7.3). */
interface Reading {
  readonly localDate: LocalDate;
  readonly startMinutes: MinuteOfDay;
}

/** Noon in Sofia, that many days before today, as the statistics hold a visit. */
function daysAgo(days: number): Reading {
  return {
    localDate: LocalDate.addDays(day(TODAY), -days),
    startMinutes: minute(12 * 60),
  };
}

/** A client's statistics as stored: `clientStats/{customerId}`, the flat body (Law 5). */
function statsOf(id: string, visits: readonly Reading[]): ClientStatsRecord {
  const customerId = CustomerId.of(id);
  const first = visits[0] ?? null;
  return {
    ...ClientStats.empty(),
    lifetimeVisitsCompleted: visits.length,
    last365VisitsCompleted: visits.map((visit, index) => ({
      appointmentId: AppointmentId.of(`appt-${id}-${index}`),
      localDate: visit.localDate,
      startMinutes: visit.startMinutes,
    })),
    firstVisitLocalDate: first?.localDate ?? null,
    firstVisitStartMinutes: first?.startMinutes ?? null,
    id: customerId,
    customerId,
    version: 1,
    updatedAtUtcMs: utcMs(`${TODAY}T06:00:00+00:00`),
    ...PolicyPassStamp.NONE,
  };
}

/**
 * `CLIENT_STATS_READ_PORTS.pageClientStats` over the in-memory reference
 * (`memoryClientStatsReadPorts`), each call kept (`{ limit, after }`) and a
 * failure switched on and off at will — a failing page is still a call.
 */
function statsReader(records: readonly ClientStatsRecord[] = []) {
  const memory = memoryClientStatsReadPorts({ stats: records });
  const calls: { readonly limit: number; readonly after: string | null }[] = [];
  let failure: RepositoryError | null = null;
  const reader = {
    calls,
    pageClientStats: (async (after, limit) => {
      calls.push({ limit, after });
      return failure === null
        ? memory.pageClientStats(after, limit)
        : Result.err(failure);
    }) satisfies ClientStatsPagePorts['pageClientStats'],
    failWith(error: RepositoryError = RepositoryError.unavailable()) {
      failure = error;
      return reader;
    },
    recover() {
      failure = null;
      return reader;
    },
  };
  return reader;
}

/**
 * Three people: one who comes every four weeks, one who came six weeks
 * apart and is due in two days, one who came once long ago.
 */
function shop(): ClientStatsRecord[] {
  return [
    statsOf('client-steady', [
      daysAgo(94),
      daysAgo(66),
      daysAgo(38),
      daysAgo(10),
    ]),
    statsOf('client-six-weeks', [daysAgo(82), daysAgo(40)]),
    statsOf('client-gone', [daysAgo(200)]),
  ];
}

// ── The rule's ports, recorded and held ──────────────────────────────────

/**
 * The server's notice policy (the gateway double's pipeline judges by it):
 * no client sees the rhythm yet, 30 days of notice once one does.
 */
const SERVER_POLICY: StreakNoticePolicy = {
  clientsSeeRhythm: false,
  noticeDays: 30,
};

/**
 * The rule's two bundles over ONE world — the head stream
 * (`memoryStreakDefinitionPorts`) and the gateway over the real publish
 * pipeline (`memoryStreakPublishGatewayPorts`) — behind the recorder, and
 * the server's clock, which a spec moves (`advanceTo`): a version that
 * waited is in force from its own day on, with no write.
 */
type Rules = RhythmRecorder & {
  readonly world: StreakWorld;
  readonly gateway: StreakPublishGatewayPorts;
  readonly advanceTo: (today: string) => void;
};

function rulesOver(world: StreakWorld): Rules {
  // 09:00 UTC on the shop's day: the instant of a write.
  const server = { now: utcMs(`${TODAY}T09:00:00.000Z`) };
  const gateway = memoryStreakPublishGatewayPorts(world, {
    nowUtcMs: () => server.now,
    policy: SERVER_POLICY,
  });
  const recorder = rhythmRecorder(memoryStreakDefinitionPorts(world), gateway);
  return Object.assign(recorder, {
    world,
    gateway,
    advanceTo: (today: string) => {
      server.now = utcMs(`${today}T09:00:00.000Z`);
      recorder.tell();
    },
  });
}

/** The fixtures' rule, with the history the seed gives it: version 1, which the shop opened with. */
const seeded = (): Rules =>
  rulesOver(
    memoryStreakWorld({
      heads: [streakDefinitionFixture()],
      versions: [
        {
          streakId: StreakRule.DEFAULT_DEFINITION_ID,
          version: streakDefinitionVersionFixture(),
        },
      ],
    }),
  );

/** A shop that has published no rule yet. */
const unpublished = (): Rules => rulesOver(memoryStreakWorld());

/** Heads wait until `tellHeads()`. */
const holdingHeads = (rules: Rules): Rules => {
  rules.holdHeads();
  return rules;
};

/** Writes wait, unanswered, until `answerWrites()`. */
const holdingWrites = (rules: Rules): Rules => {
  rules.holdWrites();
  return rules;
};

/** The head as the world holds it now. */
function headIn(world: StreakWorld): StreakDefinition | null {
  let head: StreakDefinition | null = null;
  memoryStreakDefinitionPorts(world)
    .observeStreakDefinitionHead(StreakRule.DEFAULT_DEFINITION_ID)
    .pipe(take(1))
    .subscribe((read) => {
      if (read.ok) head = read.value;
    });
  return head;
}

/** A revision of the recommended rule: any option figure, the interval or the qualifier whole. */
type RulePatch = Partial<
  Omit<StreakRule.Options, 'version' | 'effectiveFromLocalDate'>
> & {
  readonly interval?: StreakIntervalRule;
  readonly qualifier?: StreakQualifierRule;
};

/** Somebody else's publish: the recommended rule revised, straight to the gateway, under their own intent. */
async function elsewhere(
  rules: Rules,
  patch: RulePatch,
  effectiveFrom: string,
  baseVersion: number,
): Promise<void> {
  const { interval, qualifier, ...options } = patch;
  const next = StreakRule.parse({
    ...StreakRule.DEFAULT,
    ...options,
    ...(interval ?? StreakIntervalRule.of(StreakRule.DEFAULT)),
    ...(qualifier ?? StreakQualifierRule.of(StreakRule.DEFAULT)),
    version: baseVersion + 1,
    effectiveFromLocalDate: effectiveFrom,
  });
  if (!next.ok) throw new Error('the other rule was refused');
  const written = await rules.gateway.publishStreakRule({
    requestId: PublishRequestId.of(`elsewhere-${baseVersion}-${effectiveFrom}`),
    streakId: StreakRule.DEFAULT_DEFINITION_ID,
    baseVersion,
    rule: next.value,
    streakTransition: StreakTransition.Grandfather,
    previewHash: null,
  });
  if (!written.ok) throw new Error(written.error.errorCode);
}

// ── The rig ──────────────────────────────────────────────────────────────

interface RigOptions {
  readonly flags?: Readonly<Record<string, boolean>>;
  /** The rule's ports, recorded. The seeded rule unless said. */
  readonly rules?: Rules;
  /** What is bound to both rule tokens in place of `rules`; `null` binds no port at all. */
  readonly port?: (StreakDefinitionPorts & StreakPublishGatewayPorts) | null;
  /** What is bound in place of the three clients' statistics; `null` binds none. */
  readonly directory?: ClientStatsPagePorts | null;
  /** Where the shop's zone is read — the fixture centre shop as the default location unless said. */
  readonly locations?: LocationLoadPorts;
}

function rig(options: RigOptions = {}) {
  const rules = options.rules ?? seeded();
  const port = options.port === undefined ? rules.ports : options.port;
  const stats = statsReader(shop());
  const directory = options.directory === undefined ? stats : options.directory;
  const clock = { now: NOW };
  let issued = 0;
  const bind = <T>(token: unknown, value: T | null) =>
    value === null ? [] : [{ provide: token, useValue: value }];
  TestBed.configureTestingModule({
    providers: [
      AdminRhythmStore,
      provideFlags(options.flags ?? { 'loyalty.streaks': true }),
      ...provideTransloco({
        config: {
          availableLangs: ['bg', 'en'],
          defaultLang: 'bg',
          fallbackLang: 'bg',
          missingHandler: { logMissingKey: false },
        },
        loader: CatalogueLoader,
      }),
      {
        provide: CLOCK_PORTS,
        useValue: {
          // The clock's reading is a Sofia wall-clock time, read in the shop's zone.
          nowUtcMs: () =>
            unwrapOk(ZonedTimeSystem.parseIsoIn(clock.now, FIXTURE_TIME_ZONE)),
        },
      },
      {
        provide: ID_PORTS,
        useValue: {
          nextId: () => {
            issued += 1;
            return `request-${String(issued).padStart(12, '0')}`;
          },
        },
      },
      // The shop's zone: the default location's, the fixture centre shop's.
      {
        provide: LOCATION_LOAD_PORTS,
        useValue:
          options.locations ??
          memoryLocationLoadPorts(
            memoryProgramsWorld({ locations: [locationFixture()] }),
          ),
      },
      {
        provide: DEFAULT_LOCATION_PORTS,
        useValue: memoryDefaultLocationPorts(),
      },
      ...bind(STREAK_DEFINITION_PORTS, port),
      ...bind(STREAK_PUBLISH_PORTS, port),
      ...bind(CLIENT_STATS_READ_PORTS, directory),
    ],
  });
  return { store: TestBed.inject(AdminRhythmStore), rules, stats, clock };
}

/** Lets every pending read answer (real timers). */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((done) => setTimeout(done, 0));
  }
}

/** A store on the seeded rule, its first answers in. */
async function loaded(options: RigOptions = {}) {
  const made = rig(options);
  made.store.load();
  await settle();
  return made;
}

/** The interval a rule (or a draft, or a call's rule) holds, as a slice of its own. */
const intervalOf = (rule: StreakIntervalRule | undefined) =>
  rule === undefined ? undefined : StreakIntervalRule.of(rule);

const fixed = (days: number) => fixedInterval(days);

/** The recommended rule, as the form holds it. */
const RECOMMENDED: StreakRuleInput = StreakRule.DEFAULT;
const LOOSER: AdminRhythmPatch = { interval: fixed(49) };
const STRICTER: AdminRhythmPatch = { interval: fixed(35) };
const LONG: AdminRhythmPatch = { interval: fixed(84) };
const NEUTRAL: AdminRhythmPatch = { riskLeadDays: 3 };

/** «Посещение с избрани услуги», by id. */
const services = (...ids: readonly string[]): StreakQualifierRule =>
  StreakQualifierRule.services(ids.map((id) => ServiceId.of(id)));

/** The rule moved under the draft — the refusal the page words as «променено от друг». */
const STALE = { errorCode: StreakPublishErrorCode.Stale };

/** A write that got no answer. */
const UNANSWERED = { ok: false, error: RepositoryError.unavailable() };

const numbersOf = (store: AdminRhythmStore): readonly number[] => {
  const versions = store.versions();
  return versions.loadState === LoadState.Ready
    ? versions.data.map((version) => version.version)
    : [];
};

afterEach(() => {
  vi.useRealTimers();
});

// ── The draft, clamped (pure) ────────────────────────────────────────────

describe('patchedRhythmDraft', () => {
  const patched = (
    patch: AdminRhythmPatch,
    draft: StreakRuleInput = RECOMMENDED,
  ) => patchedRhythmDraft(draft, patch);

  it('answers a new draft and leaves the one in hand as it was', () => {
    const before = structuredClone(RECOMMENDED);
    const next = patched({ graceDays: 10 });

    expect(next).not.toBe(RECOMMENDED);
    expect(next.graceDays).toBe(10);
    expect(RECOMMENDED).toEqual(before);
  });

  it('keeps every figure it is not handed', () => {
    expect(patched({})).toEqual(RECOMMENDED);
    expect(patched({ graceDays: 10 })).toEqual({
      ...RECOMMENDED,
      graceDays: 10,
    });
  });

  it('never moves a version’s identity', () => {
    const next = patched({ enabled: false, graceDays: 3 });

    // The id and the name are the head's: a draft carries neither.
    expect(next.version).toBe(RECOMMENDED.version);
    expect(next.effectiveFromLocalDate).toBe(
      RECOMMENDED.effectiveFromLocalDate,
    );
  });

  it.each([
    ['the interval, under two weeks', { interval: fixed(1) }, 14],
    ['the interval, over half a year', { interval: fixed(999) }, 182],
    ['the interval, a fraction', { interval: fixed(42.4) }, 42],
    ['the interval, no number', { interval: fixed(Number.NaN) }, 42],
  ] as const)('clamps %s', (_, patch, days) => {
    expect(intervalOf(patched(patch))).toEqual(StreakIntervalRule.fixed(days));
  });

  it.each([
    ['grace over its range', { graceDays: 30 }, { graceDays: 21 }],
    ['grace under it', { graceDays: -4 }, { graceDays: 0 }],
    ['grace, a fraction', { graceDays: 6.6 }, { graceDays: 7 }],
    [
      'grace, no number',
      { graceDays: Number.POSITIVE_INFINITY },
      { graceDays: 7 },
    ],
    ['the cue under its range', { riskLeadDays: -1 }, { riskLeadDays: 0 }],
    ['the minimum gap over its range', { minGapDays: 99 }, { minGapDays: 14 }],
    ['the minimum gap under it', { minGapDays: -1 }, { minGapDays: 0 }],
  ] as const)('clamps %s', (_, patch, kept) => {
    expect(patched(patch)).toEqual({ ...RECOMMENDED, ...kept });
  });

  it('clamps each part’s figures to the domain’s range', () => {
    expect(patched({ bookingHoldMaxDaysPastDue: 99 })).toMatchObject({
      bookingHoldEnabled: true,
      bookingHoldMaxDaysPastDue: 28,
    });
    expect(patched({ bookingHoldMaxDaysPastDue: -5 })).toMatchObject({
      bookingHoldEnabled: true,
      bookingHoldMaxDaysPastDue: 0,
    });
    expect(
      patched({ protectionsMaxBanked: 9, protectionsEarnEvery: 0 }),
    ).toMatchObject({
      protectionsEnabled: true,
      protectionsMaxBanked: 5,
      protectionsEarnEvery: 1,
      protectionsStartWith: 0,
    });
    expect(patched({ protectionsEarnEvery: 99 })).toMatchObject({
      protectionsEnabled: true,
      protectionsMaxBanked: 2,
      protectionsEarnEvery: 24,
      protectionsStartWith: 0,
    });
    expect(
      patched({ clientPauseEnabled: true, clientPauseMaxDaysPerYear: 999 }),
    ).toMatchObject({
      clientPauseEnabled: true,
      clientPauseMaxDaysPerYear: 180,
    });
    expect(patched({ repairWindowDays: 0, repairPerYear: 9 })).toMatchObject({
      repairEnabled: true,
      repairWindowDays: 1,
      repairPerYear: 4,
    });
  });

  it('changes one figure of a part and keeps the rest of it', () => {
    expect(patched({ bookingHoldEnabled: false })).toMatchObject({
      bookingHoldEnabled: false,
      bookingHoldMaxDaysPastDue: 14,
    });
    expect(patched({ repairWindowDays: 21 })).toMatchObject({
      repairEnabled: true,
      repairWindowDays: 21,
      repairPerYear: 1,
    });
  });

  it('pulls grace, the cue and the minimum gap under a shorter interval', () => {
    const long = patched({ graceDays: 21, riskLeadDays: 14, minGapDays: 14 });
    const short = patched({ interval: fixed(14) }, long);

    expect(intervalOf(short)).toEqual(StreakIntervalRule.fixed(14));
    expect(short.graceDays).toBe(13);
    expect(short.minGapDays).toBe(13);
    // The cue is a menu: the longest it offers that fits, never «13 дни».
    expect(short.riskLeadDays).toBe(7);
    expect(ADMIN_RHYTHM_CHOICES.riskLeadDays).toContain(short.riskLeadDays);
  });

  it('leaves them alone under an interval they already fit', () => {
    const next = patched({ interval: fixed(28) });

    expect(next.graceDays).toBe(7);
    expect(next.riskLeadDays).toBe(7);
    expect(next.minGapDays).toBe(7);
  });

  it('holds what a run starts with to what the reserve holds', () => {
    expect(patched({ protectionsStartWith: 4 }).protectionsStartWith).toBe(2);
    const one = patched({ protectionsStartWith: 1 });
    expect(one.protectionsStartWith).toBe(1);
    expect(patched({ protectionsMaxBanked: 0 }, one)).toMatchObject({
      protectionsEnabled: true,
      protectionsMaxBanked: 0,
      protectionsEarnEvery: 5,
      protectionsStartWith: 0,
    });
  });

  it('opens a personal interval on the recommended figures, around the interval it had', () => {
    expect(intervalOf(patched({ interval: personalInterval() }))).toEqual(
      StreakIntervalRule.personal(50, 21, 70, 42),
    );
    // A fixed interval outside the recommended clamp lands on its edge.
    expect(
      patched({ interval: personalInterval() }, patched(LONG)),
    ).toMatchObject({
      intervalMinDays: 21,
      intervalMaxDays: 70,
      intervalFallbackDays: 70,
    });
  });

  it('lets the figure in hand win over the other end of the clamp', () => {
    const personal = patched({ interval: personalInterval() });

    expect(
      intervalOf(
        patched(
          { interval: personalInterval({ intervalMinDays: 84 }) },
          personal,
        ),
      ),
    ).toEqual(StreakIntervalRule.personal(50, 84, 84, 84));
    expect(
      intervalOf(
        patched(
          { interval: personalInterval({ intervalMaxDays: 14 }) },
          personal,
        ),
      ),
    ).toEqual(StreakIntervalRule.personal(50, 14, 14, 14));
  });

  it('keeps the newcomer’s interval inside the clamp', () => {
    const personal = patched({ interval: personalInterval() });

    expect(
      patched(
        { interval: personalInterval({ intervalFallbackDays: 7 }) },
        personal,
      ),
    ).toMatchObject({
      intervalMinDays: 21,
      intervalMaxDays: 70,
      intervalFallbackDays: 21,
    });
    expect(
      patched(
        { interval: personalInterval({ intervalFallbackDays: 120 }) },
        personal,
      ),
    ).toMatchObject({
      intervalMinDays: 21,
      intervalMaxDays: 70,
      intervalFallbackDays: 70,
    });
    expect(
      patched(
        { interval: personalInterval({ intervalTolerancePct: 140 }) },
        personal,
      ),
    ).toMatchObject({ intervalTolerancePct: 100 });
  });

  it('holds grace under the personal interval’s FLOOR, the shortest period it opens', () => {
    const personal = patched({
      interval: personalInterval({ intervalMinDays: 14 }),
      graceDays: 21,
    });

    expect(personal.graceDays).toBe(13);
  });

  it('goes back to a fixed interval on the newcomer’s, or on the one it remembers', () => {
    const personal = patched({
      interval: personalInterval({ intervalFallbackDays: 56 }),
    });

    expect(
      intervalOf(patched({ interval: fixedInterval() }, personal)),
    ).toEqual(StreakIntervalRule.fixed(56));
    expect(
      intervalOf(
        patchedRhythmDraft(
          personal,
          { interval: fixedInterval() },
          { fixed: StreakIntervalRule.fixed(35), personal: null },
        ),
      ),
    ).toEqual(StreakIntervalRule.fixed(35));
  });

  it('holds the excuses to the rule’s vocabulary, in its order, each once', () => {
    expect(
      patched({
        excuses: [
          StreakExcuse.ClosedDays,
          StreakExcuse.ShopClosure,
          StreakExcuse.ClosedDays,
          'HOLIDAY' as never,
        ],
      }).excuses,
    ).toEqual([StreakExcuse.ShopClosure, StreakExcuse.ClosedDays]);
    expect(patched({ excuses: [] }).excuses).toEqual([]);
  });

  it('takes the choice of what counts as it is handed, in a list of its own', () => {
    const serviceIds = [ServiceId.of('svc-fade'), ServiceId.of('svc-beard')];
    const next = patched({
      qualifier: StreakQualifierRule.services(serviceIds),
    });

    expect(StreakQualifierRule.of(next)).toEqual(
      StreakQualifierRule.services(serviceIds),
    );
    expect(
      next.streakQualifier === StreakQualifier.Services &&
        next.qualifierServiceIds,
    ).not.toBe(serviceIds);
  });

  it('never leaves a rule the domain refuses, whatever figures it is handed', () => {
    // A long walk of wild changes, each over the draft the last one left.
    let seed = 20260928;
    const random = (): number => {
      seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296;
      return seed / 4_294_967_296;
    };
    const wild = (): number => Math.round(random() * 450 - 50) / 2;
    const flip = (): boolean => random() < 0.5;
    const changes: (() => AdminRhythmPatch)[] = [
      () => ({ interval: fixed(wild()) }),
      () => ({ interval: personalInterval({ intervalMinDays: wild() }) }),
      () => ({ interval: personalInterval({ intervalMaxDays: wild() }) }),
      () => ({ interval: personalInterval({ intervalFallbackDays: wild() }) }),
      () => ({ interval: personalInterval({ intervalTolerancePct: wild() }) }),
      () => ({ interval: flip() ? fixedInterval() : personalInterval() }),
      () => ({ graceDays: wild(), riskLeadDays: wild() }),
      () => ({ minGapDays: wild() }),
      () => ({
        bookingHoldEnabled: flip(),
        bookingHoldMaxDaysPastDue: wild(),
      }),
      () => ({ protectionsMaxBanked: wild(), protectionsStartWith: wild() }),
      () => ({ protectionsEnabled: flip(), protectionsEarnEvery: wild() }),
      () => ({
        clientPauseEnabled: flip(),
        clientPauseMaxDaysPerYear: wild(),
      }),
      () => ({ repairWindowDays: wild(), repairPerYear: wild() }),
      () => ({
        onBreak: flip() ? StreakOnBreak.Hold : StreakOnBreak.Restart,
        enabled: flip(),
      }),
    ];

    let draft: StreakRuleInput = RECOMMENDED;
    for (let step = 0; step < 600; step += 1) {
      const change = changes.at(Math.floor(random() * changes.length));
      if (change === undefined) continue;
      const patch = change();
      draft = patchedRhythmDraft(draft, patch);
      const rule = StreakRule.parse(draft);
      expect(
        rule.ok ? [] : rule.error.map((error) => error.errorCode),
        `step ${step}: ${JSON.stringify(patch)}`,
      ).toEqual([]);
    }
  });
});

// ── The store ────────────────────────────────────────────────────────────

describe('AdminRhythmStore: opening', () => {
  it('holds the page’s figures', () => {
    expect(StreakRule.DEFAULT_DEFINITION_ID).toBe('cadence');
    expect(StreakRule.RULE_CHANGE_NOTICE_DAYS).toBe(30);
    expect(ADMIN_RHYTHM_READ_TIMEOUT_MS).toBe(10_000);
    expect(ADMIN_RHYTHM_HISTORY_LIMIT).toBe(20);
  });

  it('is loading until the rule answers, with nothing to save', async () => {
    const rules = holdingHeads(seeded());
    const { store } = rig({ rules });
    store.load();

    expect(store.schedule()).toEqual({
      loadState: LoadState.Loading,
    });
    expect(store.versions().loadState).toBe(LoadState.Loading);
    expect(store.inForce()).toBeNull();
    expect(store.upcoming()).toBeNull();
    expect(store.dirty()).toBe(false);
    expect(store.canSave()).toBe(false);
    expect(store.validation()).toEqual([]);
    expect(store.change()).toBeNull();
    expect(store.preview()).toBeNull();

    rules.tellHeads();
    await settle();
    expect(store.schedule().loadState).toBe(LoadState.Ready);
  });

  it('opens on the rule in force, with its history', async () => {
    const { store, rules } = await loaded();

    const schedule = store.schedule();
    expect(schedule.loadState).toBe(LoadState.Ready);
    expect(
      schedule.loadState === LoadState.Ready &&
        StreakRuleSystem.current(schedule.data).version,
    ).toBe(1);
    expect(store.published()).toBe(true);
    expect(store.inForce()?.version).toBe(1);
    expect(store.upcoming()).toBeNull();
    expect(store.draft()).toEqual(RECOMMENDED);
    expect(store.dirty()).toBe(false);
    expect(store.canSave()).toBe(false);
    expect(store.change()).toEqual({
      direction: StreakRuleDirection.Neutral,
      changed: [],
    });
    expect(numbersOf(store)).toEqual([1]);
    expect(rules.observations).toHaveLength(1);
    expect(rules.historyReads).toHaveLength(1);
  });

  it('knows the shop’s days', async () => {
    const { store } = await loaded();

    expect(store.days()).toEqual({
      today: TODAY,
      tomorrow: TOMORROW,
      firstOfMonth: FIRST_OF_MONTH,
    });
    expect(store.effectiveFrom()).toBe(TOMORROW);
    expect(store.transition).toBe(StreakTransition.Grandfather);
  });

  it('opens a shop with no rule on the recommended one, ready to be saved', async () => {
    const { store } = await loaded({ rules: unpublished() });

    expect(store.schedule().loadState).toBe(LoadState.Ready);
    expect(store.published()).toBe(false);
    expect(store.draft()).toEqual(RECOMMENDED);
    expect(store.dirty()).toBe(false);
    expect(store.canSave()).toBe(true);
    expect(store.versions()).toEqual({
      loadState: LoadState.Ready,
      data: [],
    });
  });

  it('fails when the rule cannot be read, and reads again on «Опитай пак»', async () => {
    const rules = seeded();
    rules.failWith();
    const { store } = await loaded({ rules });

    expect(store.schedule()).toEqual({
      loadState: LoadState.Failed,
    });
    expect(store.versions()).toEqual({
      loadState: LoadState.Failed,
    });
    expect(store.canSave()).toBe(false);

    rules.recover();
    store.retry();
    await settle();

    expect(store.schedule().loadState).toBe(LoadState.Ready);
    expect(store.draft()).toEqual(RECOMMENDED);
    expect(numbersOf(store)).toEqual([1]);
  });

  it('reads the shop’s zone before the rule: a zone that cannot be read is the rule’s failed read, and «Опитай пак» reads both', async () => {
    const rules = seeded();
    const shops = memoryLocationLoadPorts(
      memoryProgramsWorld({ locations: [locationFixture()] }),
    );
    let down = true;
    const locations: LocationLoadPorts = {
      loadLocation: (id) =>
        down
          ? Promise.resolve(
              Result.err(RepositoryError.readFailed(null, 'down')),
            )
          : shops.loadLocation(id),
    };
    const { store } = await loaded({ rules, locations });

    expect(store.schedule()).toEqual({
      loadState: LoadState.Failed,
    });
    // No rule is listened to on a day the page cannot name.
    expect(rules.observations).toEqual([]);
    expect(store.days()).toBeNull();
    expect(store.effectiveFrom()).toBeNull();
    expect(store.sample()).toBeNull();
    expect(store.canSave()).toBe(false);

    down = false;
    store.retry();
    await settle();

    expect(store.schedule().loadState).toBe(LoadState.Ready);
    expect(rules.observations).toHaveLength(1);
    expect(store.days()?.today).toBe(TODAY);
    expect(store.draft()).toEqual(RECOMMENDED);
  });

  it('reads the history again when only the history failed', async () => {
    const rules = seeded();
    const failing = vi
      .spyOn(rules.ports, 'listStreakDefinitionVersions')
      .mockResolvedValueOnce(Result.err(RepositoryError.unavailable()));
    const { store } = await loaded({ rules });

    expect(store.schedule().loadState).toBe(LoadState.Ready);
    expect(store.versions()).toEqual({
      loadState: LoadState.Failed,
    });

    store.retry();
    await settle();

    expect(numbersOf(store)).toEqual([1]);
    expect(rules.observations).toHaveLength(1);
    failing.mockRestore();
  });

  it('fails without the rule’s port', async () => {
    const { store } = await loaded({ port: null });

    expect(store.schedule()).toEqual({
      loadState: LoadState.Failed,
    });
    expect(store.versions()).toEqual({
      loadState: LoadState.Failed,
    });
    expect(store.patch(LOOSER)).toEqual(RECOMMENDED);
    expect(store.dirty()).toBe(false);
    await expect(store.save()).resolves.toEqual(UNANSWERED);
    await expect(store.undo()).resolves.toEqual(UNANSWERED);
  });

  it('counts a rule that does not answer within ten seconds as failed', async () => {
    vi.useFakeTimers();
    const silent: StreakDefinitionPorts & StreakPublishGatewayPorts = {
      observeStreakDefinitionHead: () => NEVER,
      listStreakDefinitionVersions: () => new Promise(() => undefined),
      publishStreakRule: () => new Promise(() => undefined),
      withdrawStreakRule: () => new Promise(() => undefined),
    };
    const { store } = rig({ port: silent });
    store.load();

    await vi.advanceTimersByTimeAsync(ADMIN_RHYTHM_READ_TIMEOUT_MS - 1);
    expect(store.schedule()).toEqual({
      loadState: LoadState.Loading,
    });
    expect(store.versions()).toEqual({
      loadState: LoadState.Loading,
    });

    await vi.advanceTimersByTimeAsync(1);
    expect(store.schedule()).toEqual({
      loadState: LoadState.Failed,
    });
    expect(store.versions()).toEqual({
      loadState: LoadState.Failed,
    });
  });

  it('keeps the rule on screen when a later read fails', async () => {
    const { store, rules } = await loaded();

    rules.failWith();
    await settle();

    expect(store.schedule().loadState).toBe(LoadState.Ready);
    expect(store.draft()).toEqual(RECOMMENDED);
  });

  it('ignores a change made before the rule has answered', () => {
    const { store } = rig({ rules: holdingHeads(seeded()) });
    store.load();

    expect(store.patch(LOOSER)).toEqual(RECOMMENDED);
    expect(store.draft()).toEqual(RECOMMENDED);
    expect(store.dirty()).toBe(false);
  });

  it('reads the rollout’s flag, and whether clients see the rhythm yet', () => {
    const { store } = rig();

    expect(store.streaksOn).toBe(true);
    expect(store.policy).toEqual({ clientsSeeRhythm: false, noticeDays: 30 });
  });

  it('holds the page to the server’s notice once clients see the rhythm', () => {
    const { store } = rig({ flags: { 'loyalty.selfView': true } });

    expect(store.streaksOn).toBe(false);
    expect(store.policy).toEqual({ clientsSeeRhythm: true, noticeDays: 30 });
  });

  it('works while the rhythm is not rolled out yet', async () => {
    const { store } = await loaded({ flags: {} });

    expect(store.streaksOn).toBe(false);
    store.patch(LOOSER);
    expect(store.canSave()).toBe(true);
    await expect(store.save()).resolves.toMatchObject({ ok: true });
  });
});

describe('AdminRhythmStore: the draft', () => {
  it('takes a change, says what moved and whom it favours', async () => {
    const { store } = await loaded();

    const draft = store.patch(LOOSER);

    expect(intervalOf(draft)).toEqual(StreakIntervalRule.fixed(49));
    expect(store.draft()).toBe(draft);
    expect(store.dirty()).toBe(true);
    expect(store.canSave()).toBe(true);
    expect(store.validation()).toEqual([]);
    expect(store.change()).toEqual({
      direction: StreakRuleDirection.Looser,
      changed: [StreakRuleParameter.Interval],
    });
  });

  it.each([
    ['a shorter interval', STRICTER, StreakRuleDirection.Stricter],
    ['the cue alone', NEUTRAL, StreakRuleDirection.Neutral],
    ['the switch', { enabled: false }, StreakRuleDirection.Switch],
    [
      'a longer interval with less grace',
      { interval: fixed(49), graceDays: 3 },
      StreakRuleDirection.Mixed,
    ],
  ] as const)('classes %s as the domain does', async (_, patch, direction) => {
    const { store } = await loaded();

    store.patch(patch);

    expect(store.change()?.direction).toBe(direction);
  });

  it('hands back the figure it kept, not the one it was handed', async () => {
    const { store } = await loaded();

    expect(store.patch({ graceDays: 60 }).graceDays).toBe(21);
    expect(store.patch({ bookingHoldMaxDaysPastDue: 99 })).toMatchObject({
      bookingHoldEnabled: true,
      bookingHoldMaxDaysPastDue: 28,
    });
    expect(store.validation()).toEqual([]);
  });

  it('moves the bounds with the draft', async () => {
    const { store } = await loaded();

    expect(store.bounds().graceDays).toEqual({ min: 0, max: 21 });
    store.patch({ interval: fixed(14) });
    expect(store.bounds().graceDays).toEqual({ min: 0, max: 13 });
    expect(store.draft().graceDays).toBe(7);
  });

  it('is no draft once it is changed back', async () => {
    const { store } = await loaded();

    store.patch(LOOSER);
    store.patch({ interval: fixed(42) });

    expect(store.draft()).toEqual(RECOMMENDED);
    expect(store.dirty()).toBe(false);
    expect(store.canSave()).toBe(false);
  });

  it('keeps the draft in hand when a change moves nothing', async () => {
    const { store } = await loaded();
    const draft = store.patch(LOOSER);

    expect(store.patch(LOOSER)).toBe(draft);
    expect(store.patch({})).toBe(draft);
    expect(store.draft()).toBe(draft);
  });

  it('remembers the interval of the other kind while the admin tries both', async () => {
    const { store } = await loaded();

    store.patch({ interval: fixed(35) });
    store.patch({
      interval: personalInterval({ intervalTolerancePct: 25 }),
    });
    expect(intervalOf(store.draft())).toEqual(
      StreakIntervalRule.personal(25, 21, 70, 35),
    );

    store.patch({ interval: fixedInterval() });
    expect(intervalOf(store.draft())).toEqual(StreakIntervalRule.fixed(35));

    store.patch({ interval: personalInterval() });
    expect(store.draft()).toMatchObject({ intervalTolerancePct: 25 });
  });

  it('names the fault of a list with nothing chosen, and keeps the dock away', async () => {
    const { store } = await loaded();

    store.patch({ qualifier: services() });

    expect(store.validation().map((error) => error.field)).toEqual([
      StreakRuleField.QualifierServiceIds,
    ]);
    expect(store.change()).toBeNull();
    expect(store.dirty()).toBe(true);
    expect(store.canSave()).toBe(false);
    expect(store.earliestDay()).toBe(TOMORROW);

    store.patch({ qualifier: services('svc-fade') });

    expect(store.validation()).toEqual([]);
    expect(store.change()).toEqual({
      direction: StreakRuleDirection.Stricter,
      changed: [StreakRuleParameter.Qualifier],
    });
    expect(store.canSave()).toBe(true);
  });

  it('goes back to the rule in force on «Отхвърли»', async () => {
    const { store } = await loaded();
    store.patch(STRICTER);
    store.setEffectiveFrom(day('2026-10-12'));

    store.discard();

    expect(store.draft()).toEqual(RECOMMENDED);
    expect(store.dirty()).toBe(false);
    expect(store.effectiveFrom()).toBe(TOMORROW);
    expect(store.refusal()).toBeNull();
    expect(store.preview()).toBeNull();
  });

  it('cannot be saved offline, and can again once the browser is back', async () => {
    const { store } = await loaded();
    store.patch(LOOSER);

    window.dispatchEvent(new Event('offline'));
    expect(store.online()).toBe(false);
    expect(store.canSave()).toBe(false);
    expect(store.dirty()).toBe(true);

    window.dispatchEvent(new Event('online'));
    expect(store.online()).toBe(true);
    expect(store.canSave()).toBe(true);
  });
});

describe('AdminRhythmStore: the day a change starts', () => {
  it('starts what favours the client tomorrow', async () => {
    const { store } = await loaded();
    store.patch(LOOSER);

    expect(store.earliestDay()).toBe(TOMORROW);
    expect(store.effectiveFrom()).toBe(TOMORROW);
  });

  it('may start what only moves the team’s cue today, and offers tomorrow', async () => {
    const { store } = await loaded();
    store.patch(NEUTRAL);

    expect(store.earliestDay()).toBe(TODAY);
    expect(store.effectiveFrom()).toBe(TOMORROW);
    expect(store.setEffectiveFrom(day(TODAY))).toBe(TODAY);
  });

  it('starts a stricter rule tomorrow while no client sees the rhythm', async () => {
    const { store } = await loaded();
    store.patch(STRICTER);

    expect(store.earliestDay()).toBe(TOMORROW);
  });

  it('owes the clients thirty days once they see it', async () => {
    const { store } = await loaded({
      flags: { 'loyalty.streaks': true, 'loyalty.selfView': true },
    });
    store.patch(STRICTER);

    expect(store.earliestDay()).toBe('2026-10-28');
    expect(store.effectiveFrom()).toBe('2026-10-28');

    store.patch(LOOSER);
    expect(store.earliestDay()).toBe(TOMORROW);
    expect(store.effectiveFrom()).toBe(TOMORROW);
  });

  it('takes the day the admin chose', async () => {
    const { store } = await loaded();
    store.patch(LOOSER);

    expect(store.setEffectiveFrom(day(FIRST_OF_MONTH))).toBe(FIRST_OF_MONTH);
    expect(store.effectiveFrom()).toBe(FIRST_OF_MONTH);
    expect(store.change()?.direction).toBe(StreakRuleDirection.Looser);
  });

  it('never goes under the first day the change may start', async () => {
    const { store } = await loaded();
    store.patch(LOOSER);

    expect(store.setEffectiveFrom(day(TODAY))).toBe(TOMORROW);
    expect(store.setEffectiveFrom(day('2026-01-01'))).toBe(TOMORROW);
  });

  // «takes «%s» for no day» (`''`, `'утре'`, `'2026-13-40'`, `'28.09.2026'`)
  // is retired on purpose (pass D §4.2 class 4): `setEffectiveFrom` takes a
  // `LocalDate`, so a text that is no day can no longer reach the store —
  // the refusal is the month picker's edge's (`admin-rhythm-sheet.spec.ts`,
  // «a key that is no day changes nothing»).
});

describe('AdminRhythmStore: «Запази»', () => {
  it('publishes a version that waits for its day, and the form rests on the rule in force', async () => {
    const { store, rules } = await loaded();
    store.patch(LOOSER);

    const outcome = await store.save();
    await settle();

    expect(outcome).toEqual(
      Result.ok({
        version: 2,
        effectiveFromLocalDate: TOMORROW,
        streakRuleDirection: StreakRuleDirection.Looser,
        waits: true,
      }),
    );
    expect(rules.published).toHaveLength(1);
    expect(rules.published[0]).toMatchObject({
      requestId: 'request-000000000001',
      streakId: StreakRule.DEFAULT_DEFINITION_ID,
      baseVersion: 1,
      streakTransition: StreakTransition.Grandfather,
      previewHash: null,
    });
    expect(intervalOf(rules.published[0]?.rule)).toEqual(
      StreakIntervalRule.fixed(49),
    );
    const written = headIn(rules.world);
    expect(
      written === null ? null : StreakRuleSystem.scheduled(written),
    ).toMatchObject({ version: 2, effectiveFromLocalDate: TOMORROW });

    expect(store.inForce()?.version).toBe(1);
    expect(store.upcoming()?.version).toBe(2);
    expect(store.upcoming()?.streakTransition).toBe(
      StreakTransition.Grandfather,
    );
    expect(store.draft()).toEqual(RECOMMENDED);
    expect(store.dirty()).toBe(false);
    expect(store.canSave()).toBe(false);
    expect(store.saving()).toBe(false);
    expect(store.refusal()).toBeNull();
    expect(numbersOf(store)).toEqual([2, 1]);
    // The history is read once more, by the head that was heard.
    expect(rules.historyReads).toHaveLength(2);
  });

  it('publishes for today what may start today, and the form stands on it', async () => {
    const { store } = await loaded();
    store.patch(NEUTRAL);
    store.setEffectiveFrom(day(TODAY));

    const outcome = await store.save();
    await settle();

    expect(outcome).toEqual(
      Result.ok({
        version: 2,
        effectiveFromLocalDate: TODAY,
        streakRuleDirection: StreakRuleDirection.Neutral,
        waits: false,
      }),
    );
    expect(store.inForce()?.version).toBe(2);
    expect(store.upcoming()).toBeNull();
    expect(store.draft().riskLeadDays).toBe(3);
    expect(store.dirty()).toBe(false);
    expect(store.canSave()).toBe(false);
  });

  it('publishes a shop’s first rule as version 1', async () => {
    const { store, rules } = await loaded({ rules: unpublished() });

    const outcome = await store.save();
    await settle();

    expect(outcome).toMatchObject({ ok: true, value: { version: 1 } });
    expect(rules.published[0]).toMatchObject({ baseVersion: 0 });
    expect(store.published()).toBe(true);
    expect(store.inForce()?.version).toBe(1);
    expect(store.upcoming()).toBeNull();
    expect(store.canSave()).toBe(false);
    expect(numbersOf(store)).toEqual([1]);
  });

  it('publishes for the day the admin chose', async () => {
    const { store } = await loaded();
    store.patch(STRICTER);
    store.setEffectiveFrom(day('2026-10-12'));

    const outcome = await store.save();

    expect(outcome).toMatchObject({
      ok: true,
      value: {
        effectiveFromLocalDate: '2026-10-12',
        streakRuleDirection: StreakRuleDirection.Stricter,
        waits: true,
      },
    });
    expect(store.upcoming()?.effectiveFromLocalDate).toBe('2026-10-12');
    // The day was this version's: the next change starts from «От утре».
    store.patch(LOOSER);
    expect(store.effectiveFrom()).toBe(TOMORROW);
  });

  it('replaces the version that waited', async () => {
    const { store } = await loaded();
    store.patch(LOOSER);
    await store.save();
    store.patch(STRICTER);

    const outcome = await store.save();
    await settle();

    expect(outcome).toMatchObject({ ok: true, value: { version: 3 } });
    expect(store.upcoming()?.version).toBe(3);
    expect(store.inForce()?.version).toBe(1);
    const versions = store.versions();
    expect(
      versions.loadState === LoadState.Ready &&
        versions.data.map((version) => [
          version.version,
          version.withdrawnAtUtcMs !== null,
        ]),
    ).toEqual([
      [3, false],
      [2, true],
      [1, false],
    ]);
  });

  it('is in flight until it is answered, and one call however often it is pressed', async () => {
    const rules = holdingWrites(seeded());
    const { store } = await loaded({ rules });
    store.patch(LOOSER);

    const first = store.save();
    const second = store.save();

    expect(second).toBe(first);
    expect(store.saving()).toBe(true);
    expect(store.canSave()).toBe(false);

    rules.answerWrites();
    await expect(first).resolves.toMatchObject({ ok: true });
    expect(store.saving()).toBe(false);
    expect(rules.published).toHaveLength(1);
  });

  it('stands on the answer until the stream says the same (the answer first)', async () => {
    const { store, rules } = await loaded();
    store.patch(LOOSER);
    rules.holdHeads();

    await store.save();

    expect(store.upcoming()?.version).toBe(2);
    expect(store.upcoming()?.effectiveFromLocalDate).toBe(TOMORROW);
    expect(store.inForce()?.version).toBe(1);
    expect(store.draft()).toEqual(RECOMMENDED);
    expect(store.dirty()).toBe(false);
    // No head was heard, so the answer reads the history itself.
    await settle();
    expect(numbersOf(store)).toEqual([2, 1]);
    expect(rules.historyReads).toHaveLength(2);

    rules.tellHeads();
    await settle();

    expect(store.upcoming()?.version).toBe(2);
    expect(store.dirty()).toBe(false);
    expect(store.refusal()).toBeNull();
    expect(rules.historyReads).toHaveLength(2);
  });

  it('stands on the answer for a version in force at once, too', async () => {
    const { store, rules } = await loaded();
    store.patch(NEUTRAL);
    store.setEffectiveFrom(day(TODAY));
    rules.holdHeads();

    await store.save();

    expect(store.inForce()?.version).toBe(2);
    expect(store.inForce()?.riskLeadDays).toBe(3);
    expect(store.draft().riskLeadDays).toBe(3);
    expect(store.dirty()).toBe(false);

    rules.tellHeads();
    await settle();

    expect(store.inForce()?.version).toBe(2);
    expect(store.dirty()).toBe(false);
    expect(store.refusal()).toBeNull();
  });

  it('keeps the draft and says so when the server refuses the caller', async () => {
    const { store, rules } = await loaded();
    store.patch(LOOSER);
    rules.refuseWith(StreakPublishError.callerNotAdmin());

    const outcome = await store.save();

    expect(outcome).toEqual(Result.err(StreakPublishError.callerNotAdmin()));
    expect(store.refusal()).toEqual(StreakPublishError.callerNotAdmin());
    expect(intervalOf(store.draft())).toEqual(StreakIntervalRule.fixed(49));
    expect(store.dirty()).toBe(true);
    expect(store.canSave()).toBe(true);
  });

  it('names the fields the server found wrong', async () => {
    const { store, rules } = await loaded();
    store.patch(LOOSER);
    rules.refuseWith(StreakPublishError.invalid([StreakRuleField.GraceDays]));

    const outcome = await store.save();

    expect(outcome).toEqual(
      Result.err(StreakPublishError.invalid([StreakRuleField.GraceDays])),
    );
    expect(store.refusal()).toEqual(
      StreakPublishError.invalid([StreakRuleField.GraceDays]),
    );
    expect(store.dirty()).toBe(true);
  });

  it('moves the day to the earliest the server allows, and publishes on the second «Запази»', async () => {
    const { store, rules } = await loaded();
    store.patch(STRICTER);
    // The server's own day is not read: the page offers the strictest it knows.
    rules.refuseWith(StreakPublishError.tooEarly(day(TOMORROW), day(TOMORROW)));

    const outcome = await store.save();

    const refused = StreakPublishError.tooEarly(
      day(TOMORROW),
      day('2026-10-28'),
    );
    expect(outcome).toEqual(Result.err(refused));
    expect(store.refusal()).toEqual(refused);
    expect(store.earliestDay()).toBe('2026-10-28');
    expect(store.effectiveFrom()).toBe('2026-10-28');
    expect(store.dirty()).toBe(true);

    rules.recover();
    await expect(store.save()).resolves.toMatchObject({
      ok: true,
      value: { effectiveFromLocalDate: '2026-10-28' },
    });
    expect(store.refusal()).toBeNull();
  });

  it('holds the server’s day only for a change of the same direction', async () => {
    const { store, rules } = await loaded();
    store.patch(STRICTER);
    rules.refuseWith(StreakPublishError.tooEarly(day(TOMORROW), day(TOMORROW)));
    await store.save();

    store.patch({ interval: fixed(28) });
    expect(store.change()?.direction).toBe(StreakRuleDirection.Stricter);
    expect(store.earliestDay()).toBe('2026-10-28');
    expect(store.refusal()).toBeNull();

    store.patch(LOOSER);
    expect(store.earliestDay()).toBe(TOMORROW);
    expect(store.effectiveFrom()).toBe(TOMORROW);
  });

  it('keeps the intent’s id across a save that got no answer', async () => {
    const { store, rules } = await loaded();
    store.patch(LOOSER);
    rules.failWith();

    const failed = await store.save();

    expect(failed).toEqual(UNANSWERED);
    expect(store.refusal()).toEqual(RepositoryError.unavailable());
    expect(intervalOf(store.draft())).toEqual(StreakIntervalRule.fixed(49));
    expect(store.dirty()).toBe(true);

    rules.recover();
    await expect(store.save()).resolves.toMatchObject({ ok: true });
    expect(rules.published.map((request) => request.requestId)).toEqual([
      'request-000000000001',
      'request-000000000001',
    ]);
  });

  it('takes a changed draft for a new intent', async () => {
    const { store, rules } = await loaded();
    store.patch(LOOSER);
    rules.failWith();
    await store.save();
    rules.recover();

    store.patch({ graceDays: 10 });
    expect(store.refusal()).toBeNull();
    await store.save();

    expect(rules.published.map((request) => request.requestId)).toEqual([
      'request-000000000001',
      'request-000000000002',
    ]);
  });

  it('takes another day for a new intent', async () => {
    const { store, rules } = await loaded();
    store.patch(LOOSER);
    rules.failWith();
    await store.save();
    rules.recover();

    store.setEffectiveFrom(day(FIRST_OF_MONTH));
    expect(store.refusal()).toBeNull();
    await store.save();

    expect(rules.published.map((request) => request.requestId)).toEqual([
      'request-000000000001',
      'request-000000000002',
    ]);
  });

  it('answers a port that throws as a save that failed', async () => {
    const rules = seeded();
    vi.spyOn(rules.ports, 'publishStreakRule').mockRejectedValue(
      new Error('no adapter'),
    );
    const { store } = await loaded({ rules });
    store.patch(LOOSER);

    const outcome = await store.save();

    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.error.errorCode).toBe(
      RepositoryErrorCode.WriteFailed,
    );
    expect(store.saving()).toBe(false);
    expect(store.dirty()).toBe(true);
  });

  it('publishes nothing for a form that was not touched', async () => {
    const { store, rules } = await loaded();

    await expect(store.save()).resolves.toEqual(Result.ok(null));
    expect(rules.published).toEqual([]);
    expect(store.refusal()).toBeNull();
  });

  it('sends nothing for a draft that is no rule', async () => {
    const { store, rules } = await loaded();
    store.patch({ qualifier: services() });

    const outcome = await store.save();

    const invalid = StreakPublishError.invalid([
      StreakRuleField.QualifierServiceIds,
    ]);
    expect(outcome).toEqual(Result.err(invalid));
    expect(rules.published).toEqual([]);
    expect(store.refusal()).toEqual(invalid);
  });

  it('reads the clock when it saves: a tab left open overnight publishes for the new tomorrow', async () => {
    const { store, clock } = await loaded();
    store.patch(LOOSER);
    clock.now = '2026-09-29T08:05:00';

    const outcome = await store.save();

    expect(outcome).toMatchObject({
      ok: true,
      value: { effectiveFromLocalDate: '2026-09-30' },
    });
    expect(store.days()?.today).toBe('2026-09-29');
  });
});

describe('AdminRhythmStore: a rule somebody else publishes', () => {
  it('is followed by a form with no draft', async () => {
    const { store, rules } = await loaded();

    await elsewhere(rules, { riskLeadDays: 3 }, TODAY, 1);
    await settle();

    expect(store.inForce()?.version).toBe(2);
    expect(store.draft().riskLeadDays).toBe(3);
    expect(store.dirty()).toBe(false);
    expect(store.refusal()).toBeNull();
    expect(numbersOf(store)).toEqual([2, 1]);
  });

  it('is shown waiting beside a form with no draft', async () => {
    const { store, rules } = await loaded();

    await elsewhere(rules, { graceDays: 14 }, FIRST_OF_MONTH, 1);
    await settle();

    expect(store.upcoming()?.graceDays).toBe(14);
    expect(store.draft()).toEqual(RECOMMENDED);
    expect(store.dirty()).toBe(false);
    expect(store.refusal()).toBeNull();
  });

  it('is said under a draft, which keeps what the admin changed and takes the rest from the new rule', async () => {
    const { store, rules } = await loaded();
    store.patch(LOOSER);

    await elsewhere(rules, { riskLeadDays: 3 }, TODAY, 1);
    await settle();

    expect(store.refusal()).toMatchObject(STALE);
    expect(store.inForce()?.version).toBe(2);
    expect(intervalOf(store.draft())).toEqual(StreakIntervalRule.fixed(49));
    expect(store.draft().riskLeadDays).toBe(3);
    expect(store.dirty()).toBe(true);
    expect(store.change()).toEqual({
      direction: StreakRuleDirection.Looser,
      changed: [StreakRuleParameter.Interval],
    });
  });

  it('is said when it only waits, and the draft stays as it was: the rule in force did not move', async () => {
    const { store, rules } = await loaded();
    store.patch({ graceDays: 21 });

    await elsewhere(
      rules,
      { interval: StreakIntervalRule.fixed(14) },
      TOMORROW,
      1,
    );
    await settle();

    expect(store.refusal()).toMatchObject(STALE);
    expect(store.upcoming()?.version).toBe(2);
    expect(store.draft()).toEqual({ ...RECOMMENDED, graceDays: 21 });
    expect(store.change()).toEqual({
      direction: StreakRuleDirection.Looser,
      changed: [StreakRuleParameter.GraceDays],
    });
  });

  it('is published over, in the open, by the next «Запази»', async () => {
    const { store, rules } = await loaded();
    store.patch(LOOSER);
    await elsewhere(rules, { riskLeadDays: 3 }, TODAY, 1);
    await settle();

    const outcome = await store.save();
    await settle();

    expect(outcome).toMatchObject({ ok: true, value: { version: 3 } });
    expect(rules.published[0]).toMatchObject({ baseVersion: 2 });
    expect(rules.published[0]?.rule.riskLeadDays).toBe(3);
    expect(store.refusal()).toBeNull();
    expect(store.upcoming()?.version).toBe(3);
  });

  it('refuses a save it overtook, keeps the draft, and the second «Запази» goes through', async () => {
    const rules = seeded();
    const { store } = await loaded({ rules });
    store.patch(LOOSER);
    rules.holdWrites();

    const saving = store.save();
    await elsewhere(rules, { riskLeadDays: 3 }, TODAY, 1);
    await settle();
    // The head is heard while the save is in flight: its answer decides.
    expect(store.refusal()).toBeNull();
    rules.answerWrites();

    await expect(saving).resolves.toMatchObject({ ok: false, error: STALE });
    expect(store.refusal()).toMatchObject(STALE);
    expect(intervalOf(store.draft())).toEqual(StreakIntervalRule.fixed(49));
    expect(store.draft().riskLeadDays).toBe(3);
    expect(store.dirty()).toBe(true);

    await expect(store.save()).resolves.toMatchObject({
      ok: true,
      value: { version: 3 },
    });
    expect(rules.published.map((request) => request.baseVersion)).toEqual([
      1, 2,
    ]);
  });

  it('goes unsaid once the admin acts on the draft', async () => {
    const { store, rules } = await loaded();
    store.patch(LOOSER);
    await elsewhere(rules, { riskLeadDays: 3 }, TODAY, 1);
    await settle();

    store.patch({ graceDays: 10 });

    expect(store.refusal()).toBeNull();
  });

  it('is what «Отхвърли» goes back to', async () => {
    const { store, rules } = await loaded();
    store.patch(LOOSER);
    await elsewhere(rules, { riskLeadDays: 3 }, TODAY, 1);
    await settle();

    store.discard();

    expect(intervalOf(store.draft())).toEqual(StreakIntervalRule.fixed(42));
    expect(store.draft().riskLeadDays).toBe(3);
    expect(store.dirty()).toBe(false);
    expect(store.refusal()).toBeNull();
  });

  it('says nothing when the same rule is only said again', async () => {
    const { store, rules } = await loaded();
    store.patch(LOOSER);

    rules.recover();
    await settle();

    expect(store.refusal()).toBeNull();
    expect(intervalOf(store.draft())).toEqual(StreakIntervalRule.fixed(49));
    expect(rules.historyReads).toHaveLength(1);
  });
});

describe('AdminRhythmStore: a version that comes into force overnight', () => {
  /** A stricter rule waits for tomorrow; the admin drafts today; the tab stays open. */
  async function overnight(patch: AdminRhythmPatch) {
    const made = await loaded();
    await elsewhere(
      made.rules,
      { interval: StreakIntervalRule.fixed(14) },
      TOMORROW,
      1,
    );
    await settle();
    made.store.patch(patch);
    made.clock.now = '2026-09-29T08:05:00';
    made.rules.advanceTo(TOMORROW);
    await settle();
    return made;
  }

  it('sends nothing on the first «Запази»: the draft is shown over today’s rule first', async () => {
    const { store, rules } = await overnight({ graceDays: 21 });

    const outcome = await store.save();

    expect(outcome).toMatchObject({ ok: false, error: STALE });
    expect(store.refusal()).toMatchObject(STALE);
    expect(rules.published).toEqual([]);
    expect(store.days()?.today).toBe(TOMORROW);
    expect(store.inForce()?.version).toBe(2);
    expect(store.upcoming()).toBeNull();
  });

  it('carries what the admin changed over the rule of today, held to its interval', async () => {
    const { store } = await overnight({ graceDays: 21 });

    await store.save();

    expect(intervalOf(store.draft())).toEqual(StreakIntervalRule.fixed(14));
    expect(store.draft().graceDays).toBe(13);
    expect(store.validation()).toEqual([]);
    expect(store.change()).toEqual({
      direction: StreakRuleDirection.Looser,
      changed: [StreakRuleParameter.GraceDays],
    });
  });

  it('publishes on the second «Запази», over the rule of today', async () => {
    const { store, rules } = await overnight({ graceDays: 21 });
    await store.save();

    const outcome = await store.save();

    expect(outcome).toMatchObject({
      ok: true,
      value: { version: 3, effectiveFromLocalDate: '2026-09-30' },
    });
    expect(rules.published).toHaveLength(1);
    expect(rules.published[0]).toMatchObject({ baseVersion: 2 });
    expect(intervalOf(rules.published[0]?.rule)).toEqual(
      StreakIntervalRule.fixed(14),
    );
  });

  it('opens on the rule of today after «Отхвърли»', async () => {
    const { store } = await overnight({ graceDays: 21 });

    store.discard();

    expect(store.days()?.today).toBe(TOMORROW);
    expect(intervalOf(store.draft())).toEqual(StreakIntervalRule.fixed(14));
    expect(store.dirty()).toBe(false);
  });
});

describe('AdminRhythmStore: «Отмени»', () => {
  it('calls off the version that waits', async () => {
    const { store, rules } = await loaded();
    store.patch(LOOSER);
    await store.save();

    const outcome = await store.undo();
    await settle();

    expect(outcome).toEqual(Result.ok(2));
    expect(rules.withdrawn).toEqual([
      StreakPublishCall.withdraw(
        PublishRequestId.of('request-000000000002'),
        StreakRule.DEFAULT_DEFINITION_ID,
        2,
      ),
    ]);
    expect(store.upcoming()).toBeNull();
    expect(store.inForce()?.version).toBe(1);
    expect(store.withdrawing()).toBe(false);
    const versions = store.versions();
    expect(
      versions.loadState === LoadState.Ready &&
        versions.data.map((version) => [
          version.version,
          version.withdrawnAtUtcMs !== null,
        ]),
    ).toEqual([
      [2, true],
      [1, false],
    ]);
  });

  it('numbers the next version above the one called off', async () => {
    const { store } = await loaded();
    store.patch(LOOSER);
    await store.save();
    await store.undo();
    store.patch(STRICTER);

    await expect(store.save()).resolves.toMatchObject({
      ok: true,
      value: { version: 3 },
    });
  });

  it('has nothing to call off when nothing waits', async () => {
    const { store, rules } = await loaded();

    await expect(store.undo()).resolves.toEqual(Result.ok(null));
    expect(rules.withdrawn).toEqual([]);
  });

  it('keeps a draft in hand without a word: the act was the admin’s own', async () => {
    const { store } = await loaded();
    store.patch(LOOSER);
    await store.save();
    store.patch(STRICTER);

    await store.undo();
    await settle();

    expect(store.upcoming()).toBeNull();
    expect(intervalOf(store.draft())).toEqual(StreakIntervalRule.fixed(35));
    expect(store.dirty()).toBe(true);
    expect(store.refusal()).toBeNull();
  });

  it('stands on the answer until the stream says the same', async () => {
    const { store, rules } = await loaded();
    store.patch(LOOSER);
    await store.save();
    await settle();
    rules.holdHeads();

    await store.undo();

    expect(store.upcoming()).toBeNull();
    expect(store.inForce()?.version).toBe(1);

    rules.tellHeads();
    await settle();

    expect(store.upcoming()).toBeNull();
    expect(store.refusal()).toBeNull();
  });

  it('is in flight until it is answered, and one call however often it is pressed', async () => {
    const rules = seeded();
    const { store } = await loaded({ rules });
    store.patch(LOOSER);
    await store.save();
    store.patch(STRICTER);
    rules.holdWrites();

    const first = store.undo();
    const second = store.undo();

    expect(second).toBe(first);
    expect(store.withdrawing()).toBe(true);
    expect(store.canSave()).toBe(false);

    rules.answerWrites();
    await expect(first).resolves.toEqual(Result.ok(2));
    expect(store.withdrawing()).toBe(false);
    expect(store.canSave()).toBe(true);
    expect(rules.withdrawn).toHaveLength(1);
  });

  it('keeps the intent’s id across an «Отмени» that got no answer', async () => {
    const { store, rules } = await loaded();
    store.patch(LOOSER);
    await store.save();
    rules.failWith();

    await expect(store.undo()).resolves.toEqual(UNANSWERED);
    expect(store.upcoming()?.version).toBe(2);

    rules.recover();
    await expect(store.undo()).resolves.toEqual(Result.ok(2));
    expect(rules.withdrawn.map((call) => call.requestId)).toEqual([
      'request-000000000002',
      'request-000000000002',
    ]);
  });

  it('hands on the server’s refusal', async () => {
    const { store, rules } = await loaded();
    store.patch(LOOSER);
    await store.save();
    rules.refuseWith(StreakPublishError.callerNotAdmin());

    await expect(store.undo()).resolves.toEqual(
      Result.err(StreakPublishError.callerNotAdmin()),
    );
    expect(store.upcoming()?.version).toBe(2);
  });
});

describe('AdminRhythmStore: «Какво ще се промени»', () => {
  async function previewing(options: RigOptions = {}) {
    vi.useFakeTimers();
    const made = rig(options);
    made.store.load();
    await vi.advanceTimersByTimeAsync(0);
    return made;
  }

  it('has nothing to preview without a draft, and reads nothing', async () => {
    const { store, stats } = await previewing();

    await vi.advanceTimersByTimeAsync(2_000);

    expect(store.preview()).toBeNull();
    expect(store.previewBusy()).toBe(false);
    expect(stats.calls).toEqual([]);
  });

  it('recomputes by itself 600 ms after the change', async () => {
    const { store } = await previewing();

    store.patch({ interval: fixed(28) });
    expect(store.preview()).toEqual({
      loadState: LoadState.Loading,
    });
    expect(store.previewBusy()).toBe(true);

    await vi.advanceTimersByTimeAsync(599);
    expect(store.preview()).toEqual({
      loadState: LoadState.Loading,
    });

    await vi.advanceTimersByTimeAsync(1);
    expect(store.preview()).toEqual({
      loadState: LoadState.Ready,
      data: {
        streakPreviewOutcome: StreakPreviewOutcome.Estimate,
        clients: 3,
        before: { inRhythm: 2, inGrace: 0, broken: 1 },
        after: { inRhythm: 1, inGrace: 0, broken: 2 },
        back: 0,
        out: 1,
      },
    });
    expect(store.previewBusy()).toBe(false);
    expect(store.previewCapped()).toBe(false);
  });

  it('waits for the draft to rest: a change inside the pause starts the pause over', async () => {
    const { store } = await previewing();

    store.patch({ interval: fixed(28) });
    await vi.advanceTimersByTimeAsync(400);
    store.patch({ interval: fixed(49) });
    await vi.advanceTimersByTimeAsync(400);
    expect(store.preview()).toEqual({
      loadState: LoadState.Loading,
    });

    await vi.advanceTimersByTimeAsync(200);
    expect(store.preview()).toMatchObject({
      loadState: LoadState.Ready,
      data: { after: { inRhythm: 2, inGrace: 0, broken: 1 }, out: 0 },
    });
  });

  it('reads the statistics once per visit to the page, and keeps the last answer while the next is worked out', async () => {
    const { store, stats } = await previewing();
    const { calls } = stats;

    store.patch({ interval: fixed(28) });
    // The walk starts with the change, ahead of the pause.
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(600);
    const first = store.preview();

    store.patch({ interval: fixed(35) });
    expect(store.preview()).toBe(first);
    expect(store.previewBusy()).toBe(true);

    await vi.advanceTimersByTimeAsync(600);
    expect(store.preview()).not.toBe(first);
    expect(store.preview()?.loadState).toBe(LoadState.Ready);
    expect(store.previewBusy()).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('says when it stopped at the first 1 000 clients', async () => {
    const many = Array.from({ length: 1_001 }, (_, index) =>
      statsOf(`client-${String(index).padStart(5, '0')}`, [daysAgo(10)]),
    );
    const directory = statsReader(many);
    const { store } = await previewing({ directory });

    store.patch({ interval: fixed(28) });
    await vi.advanceTimersByTimeAsync(600);

    expect(store.preview()).toMatchObject({
      loadState: LoadState.Ready,
      data: {
        streakPreviewOutcome: StreakPreviewOutcome.Estimate,
        clients: 1_000,
      },
    });
    expect(store.previewCapped()).toBe(true);
    expect(directory.calls).toHaveLength(5);
  });

  it('is unavailable for chosen services, and reads nothing to say so', async () => {
    const { store, stats } = await previewing();

    store.patch({ qualifier: services('svc-fade') });
    await vi.advanceTimersByTimeAsync(600);

    expect(store.preview()).toEqual({
      loadState: LoadState.Ready,
      data: {
        streakPreviewOutcome: StreakPreviewOutcome.Unavailable,
        reason: StreakPreviewUnavailable.Qualifier,
      },
    });
    expect(store.previewBusy()).toBe(false);
    expect(stats.calls).toEqual([]);
    expect(store.canSave()).toBe(true);
  });

  it('has nothing to preview for a draft that is no rule', async () => {
    const { store } = await previewing();
    store.patch({ interval: fixed(28) });
    await vi.advanceTimersByTimeAsync(600);

    store.patch({ qualifier: services() });

    expect(store.preview()).toBeNull();
    expect(store.previewBusy()).toBe(false);
  });

  it('judges nobody under a rule that is switched off', async () => {
    const { store } = await previewing();

    store.patch({ enabled: false });
    await vi.advanceTimersByTimeAsync(600);

    expect(store.preview()).toMatchObject({
      loadState: LoadState.Ready,
      data: {
        streakPreviewOutcome: StreakPreviewOutcome.Estimate,
        before: { inRhythm: 2, inGrace: 0, broken: 1 },
        after: null,
      },
    });
  });

  it('fails when the statistics cannot be read, and walks again on «Опитай пак»', async () => {
    const directory = statsReader(shop()).failWith();
    const { store } = await previewing({ directory });

    store.patch({ interval: fixed(28) });
    await vi.advanceTimersByTimeAsync(600);

    expect(store.preview()).toEqual({
      loadState: LoadState.Failed,
    });
    expect(store.previewBusy()).toBe(false);
    // The save does not wait for a preview.
    expect(store.canSave()).toBe(true);

    // One walk failed behind the one notice: the pause did not read again.
    expect(directory.calls).toHaveLength(1);

    directory.recover();
    store.retry();
    await vi.advanceTimersByTimeAsync(0);

    expect(store.preview()).toMatchObject({
      loadState: LoadState.Ready,
      data: {
        streakPreviewOutcome: StreakPreviewOutcome.Estimate,
        clients: 3,
      },
    });
    expect(directory.calls).toHaveLength(2);
  });

  it('stays failed while the draft moves, until «Опитай пак»', async () => {
    const directory = statsReader(shop()).failWith();
    const { store } = await previewing({ directory });
    store.patch({ interval: fixed(28) });
    await vi.advanceTimersByTimeAsync(600);
    directory.recover();

    store.patch({ interval: fixed(35) });
    // No skeleton in between: there is nothing to wait for.
    expect(store.preview()).toEqual({
      loadState: LoadState.Failed,
    });
    expect(store.previewBusy()).toBe(false);
    await vi.advanceTimersByTimeAsync(600);

    expect(store.preview()).toEqual({
      loadState: LoadState.Failed,
    });
    expect(directory.calls).toHaveLength(1);
  });

  it('is absent where the statistics cannot be read at all', async () => {
    const { store } = await previewing({ directory: null });

    store.patch({ interval: fixed(28) });
    await vi.advanceTimersByTimeAsync(600);

    expect(store.preview()).toBeNull();
    expect(store.previewBusy()).toBe(false);
    expect(store.canSave()).toBe(true);
  });

  it('goes with the draft: on «Отхвърли», and once the draft is changed back', async () => {
    const { store } = await previewing();
    store.patch({ interval: fixed(28) });
    await vi.advanceTimersByTimeAsync(600);

    store.discard();
    expect(store.preview()).toBeNull();

    store.patch({ interval: fixed(28) });
    await vi.advanceTimersByTimeAsync(600);
    store.patch({ interval: fixed(42) });
    expect(store.preview()).toBeNull();
    expect(store.previewBusy()).toBe(false);
  });

  it('goes with a save', async () => {
    const { store } = await previewing();
    store.patch({ interval: fixed(28) });
    await vi.advanceTimersByTimeAsync(600);

    await store.save();

    expect(store.preview()).toBeNull();
    expect(store.previewBusy()).toBe(false);
  });

  it('drops an answer that arrives for an older draft', async () => {
    const held: (() => void)[] = [];
    const inner = statsReader(shop());
    const directory: ClientStatsPagePorts = {
      pageClientStats: (after, limit) =>
        new Promise((answer) => {
          held.push(
            () => void inner.pageClientStats(after, limit).then(answer),
          );
        }),
    };
    const { store } = await previewing({ directory });

    store.patch({ interval: fixed(28) });
    await vi.advanceTimersByTimeAsync(600);
    expect(store.preview()).toEqual({
      loadState: LoadState.Loading,
    });

    store.discard();
    for (const answer of held.splice(0)) answer();
    await vi.advanceTimersByTimeAsync(0);

    expect(store.preview()).toBeNull();
  });

  it('compares with the rule in force, not with the one that waits', async () => {
    const { store } = await previewing();
    store.patch({ interval: fixed(28) });
    await store.save();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.upcoming()?.version).toBe(2);

    store.patch({ interval: fixed(28) });
    await vi.advanceTimersByTimeAsync(600);

    expect(store.preview()).toMatchObject({
      loadState: LoadState.Ready,
      data: {
        before: { inRhythm: 2, inGrace: 0, broken: 1 },
        after: { inRhythm: 1, inGrace: 0, broken: 2 },
      },
    });
  });

  it('leaves no timer behind when the page goes', async () => {
    const { store } = await previewing();
    store.patch({ interval: fixed(28) });

    TestBed.resetTestingModule();
    await vi.advanceTimersByTimeAsync(ADMIN_RHYTHM_READ_TIMEOUT_MS);

    expect(vi.getTimerCount()).toBe(0);
    expect(store.preview()).toEqual({
      loadState: LoadState.Loading,
    });
  });
});

describe('AdminRhythmStore: the rule, worded', () => {
  it('prints the draft’s sentences as the client’s card prints a rule', async () => {
    const { store } = await loaded();

    expect(store.rule()).toMatchObject({
      sentence: 'Посещение на всеки 6 седмици пази ритъма.',
      short: 'На всеки 6 седмици · 7 дни гратис',
      details: [
        '7 дни гратис след срока.',
        'До 2 защити покриват пропуснат срок; нова на всеки 5 посещения в ритъм.',
        'Час, отменен от салона, не се брои за пропуск.',
        'Записан час до 14 дни след срока пази ритъма.',
        'След прекъсване посещение до 14 дни връща ритъма.',
      ],
    });
    expect(store.rule()?.days(1)).toBe('1 ден');
    expect(store.rule()?.weeks(5.5)).toBe('5½ седмици');
  });

  it('redraws them on every change', async () => {
    const { store } = await loaded();

    store.patch({ interval: fixed(35), graceDays: 0 });

    expect(store.rule()?.sentence).toBe(
      'Посещение на всеки 5 седмици пази ритъма.',
    );
    expect(store.rule()?.short).toBe('На всеки 5 седмици');
    expect(store.rule()?.details).not.toContain('7 дни гратис след срока.');
  });

  it('says only that it is off for a rule that is switched off', async () => {
    const { store } = await loaded();

    store.patch({ enabled: false });

    expect(store.rule()).toMatchObject({
      sentence:
        'Изключено. Картата на клиента не показва ритъм. Натрупаното се пази.',
      details: [],
    });
  });

  it('names the counted services once the page has handed over their names', async () => {
    const { store } = await loaded();
    store.patch({ qualifier: services('svc-fade', 'svc-beard') });
    expect(store.rule()?.details.at(-1)).not.toContain('Броят се');

    store.nameServices(
      new Map([
        [ServiceId.of('svc-fade'), 'Фейд'],
        [ServiceId.of('svc-beard'), 'Оформяне на брада'],
      ]),
    );

    expect(store.rule()?.details.at(-1)).toBe(
      'Броят се посещения с: Фейд и Оформяне на брада.',
    );
  });

  it('keeps the last rule it could word while the draft is none', async () => {
    const { store } = await loaded();
    store.patch({ interval: fixed(35) });

    store.patch({ qualifier: services() });

    expect(store.validation()).toHaveLength(1);
    expect(store.rule()?.sentence).toBe(
      'Посещение на всеки 5 седмици пази ритъма.',
    );
    expect(store.sample()).not.toBeNull();
  });

  it('words the version that waits', async () => {
    const { store } = await loaded();
    expect(store.upcomingRule()).toBeNull();
    store.patch({ interval: fixed(35) });

    await store.save();

    expect(store.upcomingRule()?.short).toBe(
      'На всеки 5 седмици · 7 дни гратис',
    );
    expect(store.rule()?.sentence).toBe(
      'Посещение на всеки 6 седмици пази ритъма.',
    );
  });

  it('follows the language', async () => {
    const { store } = await loaded();

    TestBed.inject(TranslocoService).setActiveLang('en');
    await settle();

    expect(store.rule()?.sentence).toBe(
      'A visit every 6 weeks keeps the rhythm.',
    );
  });
});

describe('AdminRhythmStore: the sample run', () => {
  it('draws the draft through the projector: the miss covered, then the visit', async () => {
    const { store } = await loaded();

    expect(
      store
        .sample()
        ?.periods.slice(-5)
        .map((period) => period.streakPeriodMark),
    ).toEqual([
      StreakPeriodMark.Kept,
      StreakPeriodMark.Kept,
      StreakPeriodMark.Kept,
      StreakPeriodMark.Protected,
      StreakPeriodMark.Kept,
    ]);
    expect(store.sample()?.streakPhase).toBe(StreakPhase.Active);
  });

  it('redraws on every change', async () => {
    const { store } = await loaded();

    store.patch({ protectionsEnabled: false });

    expect(
      store
        .sample()
        ?.periods.slice(-5)
        .map((period) => period.streakPeriodMark),
    ).toEqual([
      StreakPeriodMark.Kept,
      StreakPeriodMark.Kept,
      StreakPeriodMark.Kept,
      StreakPeriodMark.Missed,
      StreakPeriodMark.Kept,
    ]);
    expect(store.sample()?.current).toBe(1);
  });

  it('draws nothing under a rule that is off', async () => {
    const { store } = await loaded();

    store.patch({ enabled: false });

    expect(store.sample()).toBeNull();
  });
});
