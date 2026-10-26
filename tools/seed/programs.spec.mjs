/**
 * The seed's programs (OR-41), held to what the app reads them as and the
 * rules admit: every body is what the admin save — `ProgramsSystem` over
 * the admin form, an event's instant converted once on its shop's zone —
 * would store for it, its keys are exactly the rules' shape check
 * (`validPosition` / `validCourse` / `validEvent` of `firestore.rules`),
 * and the events follow the shop's today: one two weeks ahead, one a month
 * behind, each instant reading back as its wall clock on the shop's clock.
 *
 * Zero mapper (Law 5): a body's shape is the type checker's
 * (`fixtures/programs.fixtures.ts`, `pnpm nx typecheck seed-tools`); what
 * this spec holds is what no type can say.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EnrollmentStatus,
  PositionStatus,
  TenantConfig,
  WallTime,
} from '@core/components';
import { Collections } from '@core/entities';
import { CourseId, EventId, PositionId } from '@core/primitives';
import { ProgramsSystem, ZonedTimeSystem } from '@core/systems';
import { describe, expect, it } from 'vitest';
import { createShopCalendar } from './calendar.mjs';
import { LOCATIONS } from './fixtures/catalog.fixtures.ts';
import { WORKSPACE_ROOT } from './load-domain.mjs';
import {
  COURSES_COLLECTION,
  EVENTS_COLLECTION,
  EVENT_PLANS,
  POSITIONS_COLLECTION,
  programWritesOf,
} from './programs.mjs';

/** The shops' zone, spelled here so the spec reads instants independently of the seed. */
const SHOP_ZONE = 'Europe/Sofia';
const SHOP_WALL = new Intl.DateTimeFormat('en-CA', {
  timeZone: SHOP_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
/** An instant on the shop's clock, `YYYY-MM-DD HH:mm`. */
function shopWallOf(ms) {
  const parts = Object.fromEntries(
    SHOP_WALL.formatToParts(new Date(ms)).map(({ type, value }) => [
      type,
      value,
    ]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}
const hhmm = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** The fixtures' day, in the evening. */
const NOW = Date.parse('2026-09-28T20:00:00+03:00');

/** Early morning on days spread over two years, plus the awkward ones. */
const ANCHORS = [
  ...Array.from(
    { length: 8 },
    (_, i) => Date.parse('2026-01-02T07:30:00+02:00') + i * 91 * 86_400_000,
  ),
  Date.parse('2026-03-29T07:30:00+03:00'), // spring forward
  Date.parse('2026-10-25T07:30:00+02:00'), // fall back
  Date.parse('2028-02-29T07:30:00+02:00'), // a leap day
];

/** The keys a rules shape check admits — the `hasOnly([…])` list it opens with. */
function rulesKeysOf(rules, check) {
  const head = rules.indexOf(`function ${check}(d) {`);
  if (head === -1) throw new Error(`firestore.rules has no ${check}`);
  const open =
    rules.indexOf('d.keys().hasOnly([', head) + 'd.keys().hasOnly(['.length;
  const list = rules.slice(open, rules.indexOf('])', open));
  return list
    .split(',')
    .map((key) => key.trim().replace(/^'|'$/g, ''))
    .sort();
}

const RULES = readFileSync(join(WORKSPACE_ROOT, 'firestore.rules'), 'utf8');

/** The writes of one collection, by document id. */
function inCollection(writes, collection) {
  return writes
    .filter(({ path }) => path.startsWith(`${collection}/`))
    .map(({ path, data }) => ({ id: path.split('/')[1], data }));
}

/** The rules' `isLocalizedText`: both locales, nothing else, neither blank. */
function isLocalizedText(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    Object.keys(value).sort().join() === 'bg,en' &&
    typeof value.bg === 'string' &&
    value.bg.length > 0 &&
    typeof value.en === 'string' &&
    value.en.length > 0
  );
}
const isLinkOrNull = (value) =>
  value === null || (typeof value === 'string' && value.length > 0);
const isSortOrder = (value) => typeof value === 'number' && value >= 0;

describe('the seed’s programs', () => {
  const calendar = createShopCalendar(NOW);
  const writes = programWritesOf(calendar);
  const positions = inCollection(writes, POSITIONS_COLLECTION);
  const courses = inCollection(writes, COURSES_COLLECTION);
  const events = inCollection(writes, EVENTS_COLLECTION);

  it('writes the collections the app reads, and nothing else', () => {
    expect(POSITIONS_COLLECTION).toBe(Collections.Positions);
    expect(COURSES_COLLECTION).toBe(Collections.Courses);
    expect(EVENTS_COLLECTION).toBe(Collections.Events);
    expect(positions.length + courses.length + events.length).toBe(
      writes.length,
    );
    for (const { path } of writes)
      expect(path.split('/'), path).toHaveLength(2);
  });

  it('writes two roles, three courses and two events under fixed ids', () => {
    expect(positions.map(({ id, data }) => [id, data.positionStatus])).toEqual([
      ['pos-barber', PositionStatus.Open],
      ['pos-apprentice', PositionStatus.Closed],
    ]);
    expect(courses.map(({ id, data }) => [id, data.enrollmentStatus])).toEqual([
      ['crs-fundamentals', EnrollmentStatus.Open],
      ['crs-fade-masterclass', EnrollmentStatus.Upcoming],
      ['crs-beard-razor', EnrollmentStatus.Closed],
    ]);
    expect(events.map(({ id }) => id)).toEqual([
      'evt-open-studio',
      'evt-craft-night',
    ]);
  });

  it('titles them as the record words them', () => {
    const titles = [...positions, ...courses, ...events].map(
      ({ data }) => data.title,
    );
    expect(titles).toContainEqual({
      bg: 'Бръснар — пълно работно време',
      en: 'Barber — full time',
    });
    expect(titles).toContainEqual({
      bg: 'Основи на бръснарството',
      en: 'Barbering fundamentals',
    });
    expect(titles).toContainEqual({
      bg: 'Ден на отворените врати',
      en: 'Open studio day',
    });
  });

  it('places the events on the shop’s calendar: two weeks ahead and a month behind', () => {
    expect(EVENT_PLANS.map(({ dayOffset }) => dayOffset)).toEqual([14, -30]);
    expect(events.map(({ data }) => data.localDate)).toEqual([
      calendar.dayKeyAt(14),
      calendar.dayKeyAt(-30),
    ]);
    // On the fixtures' day: 2026-10-12 and 2026-08-29.
    expect(events.map(({ data }) => data.localDate)).toEqual([
      '2026-10-12',
      '2026-08-29',
    ]);
  });

  it('writes every body the admin save would store for it — the system judges it unchanged', () => {
    for (const { id, data } of positions) {
      const judged = ProgramsSystem.position(PositionId.of(id), {
        ...data,
        applyUrl: data.applyUrl ?? '',
      });
      expect(judged, id).toEqual({ ok: true, value: { id, ...data } });
    }
    for (const { id, data } of courses) {
      const judged = ProgramsSystem.course(CourseId.of(id), {
        ...data,
        startsLabel: data.startsLabel ?? { bg: '', en: '' },
        applyUrl: data.applyUrl ?? '',
      });
      expect(judged, id).toEqual({ ok: true, value: { id, ...data } });
    }
    const { defaultLocationId } = TenantConfig.DEFAULT;
    for (const { id, data } of events) {
      const fields = ProgramsSystem.eventFields({
        title: data.title,
        description: data.description,
        startsAt: WallTime.toLocalIso(
          WallTime.of(data.localDate, data.startMinutes),
        ),
        locationId: data.locationId ?? '',
        applyUrl: data.applyUrl ?? '',
        sortOrder: data.sortOrder,
      });
      expect(fields.ok, id).toBe(true);
      const placedAt = ProgramsSystem.zoneLocationOf(
        fields.value,
        defaultLocationId,
      );
      const shop = LOCATIONS.find((entry) => entry.id === placedAt);
      const zone = ProgramsSystem.zoneOf(
        fields.value.locationId,
        shop === undefined ? null : { id: shop.id, ...shop.body },
        defaultLocationId,
      );
      expect(zone, id).toEqual({ ok: true, value: SHOP_ZONE });
      const instant = ZonedTimeSystem.toUtc(
        fields.value.localDate,
        fields.value.startMinutes,
        zone.value,
      );
      expect(instant.ok, id).toBe(true);
      expect(
        ProgramsSystem.shopEvent(EventId.of(id), fields.value, instant.value),
        id,
      ).toEqual({ id, ...data });
    }
  });

  it('matches the rules’ shape checks key for key, and every value they test', () => {
    const shopIds = new Set(LOCATIONS.map(({ id }) => id));
    const keys = {
      positions: rulesKeysOf(RULES, 'validPosition'),
      courses: rulesKeysOf(RULES, 'validCourse'),
      events: rulesKeysOf(RULES, 'validEvent'),
    };
    for (const { id, data } of positions) {
      expect(Object.keys(data).sort(), id).toEqual(keys.positions);
      expect(isLocalizedText(data.title), id).toBe(true);
      expect(isLocalizedText(data.summary), id).toBe(true);
      expect(Array.isArray(data.locationIds), id).toBe(true);
      // A role names only shops the seed writes.
      for (const shop of data.locationIds)
        expect(shopIds.has(shop), id).toBe(true);
      expect(isLinkOrNull(data.applyUrl), id).toBe(true);
      expect(isSortOrder(data.sortOrder), id).toBe(true);
    }
    for (const { id, data } of courses) {
      expect(Object.keys(data).sort(), id).toEqual(keys.courses);
      expect(isLocalizedText(data.title), id).toBe(true);
      expect(isLocalizedText(data.description), id).toBe(true);
      expect(
        data.startsLabel === null || isLocalizedText(data.startsLabel),
        id,
      ).toBe(true);
      expect(isLinkOrNull(data.applyUrl), id).toBe(true);
      expect(isSortOrder(data.sortOrder), id).toBe(true);
    }
    for (const { id, data } of events) {
      expect(Object.keys(data).sort(), id).toEqual(keys.events);
      expect(isLocalizedText(data.title), id).toBe(true);
      expect(isLocalizedText(data.description), id).toBe(true);
      expect(data.localDate, id).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);
      expect(Number.isInteger(data.startMinutes), id).toBe(true);
      expect(data.startMinutes >= 0 && data.startMinutes < 1440, id).toBe(true);
      expect(Number.isInteger(data.utcEpochMs), id).toBe(true);
      // `exists()` on the shop: an event names a shop the seed writes, or none.
      expect(data.locationId === null || shopIds.has(data.locationId), id).toBe(
        true,
      );
      expect(isLinkOrNull(data.applyUrl), id).toBe(true);
      expect(isSortOrder(data.sortOrder), id).toBe(true);
    }
  });

  it('names one shop on the open day and none on the night behind us', () => {
    expect(events.map(({ data }) => data.locationId)).toEqual([
      'loc-center',
      null,
    ]);
    expect(positions.map(({ data }) => data.locationIds)).toEqual([
      ['loc-center'],
      [],
    ]);
  });

  it('follows the shop’s today on any day: each instant reads back as its wall clock', () => {
    for (const anchor of ANCHORS) {
      const shopCalendar = createShopCalendar(anchor);
      const placed = inCollection(
        programWritesOf(shopCalendar),
        EVENTS_COLLECTION,
      );
      expect(placed.map(({ data }) => data.localDate)).toEqual([
        shopCalendar.dayKeyAt(14),
        shopCalendar.dayKeyAt(-30),
      ]);
      for (const { id, data } of placed) {
        expect(shopWallOf(data.utcEpochMs), `${id} @ ${anchor}`).toBe(
          `${data.localDate} ${hhmm(data.startMinutes)}`,
        );
      }
    }
  });

  it('writes the same documents twice on the same day', () => {
    expect(programWritesOf(createShopCalendar(NOW + 3_600_000))).toEqual(
      writes,
    );
  });
});
