/**
 * PROGRAMS for the dev seed (OR-41, DEP-F29): the careers roles, the
 * courses and the shop events `/careers`, `/courses`, `/events` and
 * `/admin/programs` show — two roles (one open, one closed), three courses
 * (open, upcoming, closed) and two events (one two weeks ahead, one a
 * month behind). The BODIES are engine output (`fixtures/programs.fixtures.ts`:
 * the admin form judged by `ProgramsSystem`, an event's instant converted
 * once by `ZonedTimeSystem` on its shop's zone); this module decides WHEN,
 * as plain `{ path, data }` writes, every day from the shop's calendar
 * (`calendar.mjs`), so a second run the same day writes the same documents.
 * Nothing here touches Firebase.
 */
import {
  COURSE_FORMS,
  CRAFT_NIGHT,
  OPEN_STUDIO,
  POSITION_FORMS,
  courseDocument,
  positionDocument,
  shopEventDocument,
} from './fixtures/programs.fixtures.ts';

// ── The collections (`Collections` of `@core/entities`; the spec holds them equal) ─

export const POSITIONS_COLLECTION = 'positions';
export const COURSES_COLLECTION = 'courses';
export const EVENTS_COLLECTION = 'events';

/** Each event and its day, in days from the shop's today: one ahead, one behind. */
export const EVENT_PLANS = Object.freeze([
  Object.freeze({ form: OPEN_STUDIO, dayOffset: 14 }),
  Object.freeze({ form: CRAFT_NIGHT, dayOffset: -30 }),
]);

const writeOf =
  (collection) =>
  ({ id, body }) => ({ path: `${collection}/${id}`, data: body });

/**
 * Every programs document the seed writes, on `calendar`
 * (`createShopCalendar`): the roles, the courses, then the events on their
 * planned shop days.
 */
export function programWritesOf(calendar) {
  return [
    ...POSITION_FORMS.map(positionDocument).map(writeOf(POSITIONS_COLLECTION)),
    ...COURSE_FORMS.map(courseDocument).map(writeOf(COURSES_COLLECTION)),
    ...EVENT_PLANS.map(({ form, dayOffset }) =>
      shopEventDocument(form, calendar.dayKeyAt(dayOffset)),
    ).map(writeOf(EVENTS_COLLECTION)),
  ];
}
