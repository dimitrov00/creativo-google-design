import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { combineLatest, map } from 'rxjs';
import type {
  CourseInput,
  PositionInput,
  ShopEventInput,
} from '@core/components';
import type { Course, Position, ShopEvent, ShopLocation } from '@core/entities';
import type { ProgramSaveError } from '@core/errors';
import {
  type WriteProgramCommand,
  writeCourse,
  writePosition,
  writeShopEvent,
} from '@core/pipelines';
import type {
  CourseId,
  EventId,
  LocationId,
  PositionId,
  Result,
} from '@core/primitives';
import {
  CATALOG_PORTS,
  CLOCK_PORTS,
  DEFAULT_LOCATION_PORTS,
  ID_PORTS,
  LOCATION_LOAD_PORTS,
  PROGRAMS_PORTS,
} from '@creativo/infrastructure/firebase-app';

/**
 * Which list `/admin/programs` shows — the page's field `tab`, the ONLY
 * source of these strings (Law 1). Internal: the tab chips' test ids
 * (`admin-tab-positions` …) are written out in the template, never built
 * from a value, so nothing outside this lib observes the spelling.
 */
export const ProgramsTab = {
  /** The careers positions. */
  Positions: 'POSITIONS',
  /** The courses. */
  Courses: 'COURSES',
  /** The shop events. */
  Events: 'EVENTS',
} as const;
export type ProgramsTab = (typeof ProgramsTab)[keyof typeof ProgramsTab];

/**
 * Page-scoped store for `/admin/programs` — the three live lists, the
 * shops the forms pick from, and one save per kind. Component-provided,
 * not root: nothing outside this screen needs admin content-management
 * state.
 *
 * Programs content stays a rules-guarded admin write (D9(b)), so each save
 * is a browser pipeline of `@core/pipelines` over the programs suite: it
 * reads the stored document on an update (and, for an event, the shop
 * whose zone places it), lets `ProgramsSystem` judge the form, and writes
 * the flat entity whole. The page reads the save's answer: the entity, or
 * the refusals it words (`errors.<errorCode>`, OR-38).
 */
@Injectable()
export class AdminProgramsStore {
  private readonly programs = inject(PROGRAMS_PORTS);
  private readonly catalog = inject(CATALOG_PORTS);
  private readonly locations = inject(LOCATION_LOAD_PORTS);
  private readonly defaultLocation = inject(DEFAULT_LOCATION_PORTS);
  private readonly ids = inject(ID_PORTS);

  /** The instant splitting upcoming from past events — read ONCE, at construction, never rolling (F4-8). */
  private readonly nowUtcMs = inject(CLOCK_PORTS).nowUtcMs();

  private readonly savePosition = writePosition({
    ...this.programs,
    ...this.ids,
  });
  private readonly saveCourse = writeCourse({ ...this.programs, ...this.ids });
  private readonly saveEvent = writeShopEvent({
    ...this.programs,
    ...this.locations,
    ...this.defaultLocation,
    ...this.ids,
  });

  /** Every role, `sortOrder` order; empty until the first answer and on a failed read. */
  readonly positions = toSignal(
    this.programs
      .observePositions(null)
      .pipe(
        map((result): readonly Position[] => (result.ok ? result.value : [])),
      ),
    { initialValue: [] },
  );

  /** Every course, `sortOrder` order; empty until the first answer and on a failed read. */
  readonly courses = toSignal(
    this.programs
      .observeCourses(null)
      .pipe(
        map((result): readonly Course[] => (result.ok ? result.value : [])),
      ),
    { initialValue: [] },
  );

  /**
   * The upcoming events (soonest first, every one) followed by the past
   * ones (latest first, the latest 24) — empty when EITHER side fails to
   * read (F4-8).
   */
  readonly events = toSignal(
    combineLatest([
      this.programs.observeEvents({ nowUtcMs: this.nowUtcMs, upcoming: true }),
      this.programs.observeEvents({ nowUtcMs: this.nowUtcMs, upcoming: false }),
    ]).pipe(
      map(([upcoming, past]): readonly ShopEvent[] =>
        upcoming.ok && past.ok ? [...upcoming.value, ...past.value] : [],
      ),
    ),
    { initialValue: [] },
  );

  /**
   * The ACTIVE shops, `sortOrder` order — what the event's «Салон» menu and
   * the role's shop chips offer (OR-37, OR-42). The read as it answered,
   * the failure kept: `undefined` until the first answer.
   */
  readonly shops = toSignal(this.catalog.observeLocations(), {
    initialValue: undefined,
  });

  /**
   * The stored shops the active list does not hold, each read once by id
   * (OR-37, OR-42): a hidden shop answers its body, a deleted one `null`.
   * A failed read leaves its id out of the answer, so its option claims
   * neither.
   */
  async loadShops(
    ids: readonly LocationId[],
  ): Promise<ReadonlyMap<LocationId, ShopLocation | null>> {
    const answers = await Promise.all(
      ids.map(
        async (id) => [id, await this.locations.loadLocation(id)] as const,
      ),
    );
    const out = new Map<LocationId, ShopLocation | null>();
    for (const [id, answer] of answers) {
      if (answer.ok) out.set(id, answer.value);
    }
    return out;
  }

  submitPosition(
    command: WriteProgramCommand<PositionId, PositionInput>,
  ): Promise<Result<Position, readonly ProgramSaveError[]>> {
    return this.savePosition(command);
  }

  submitCourse(
    command: WriteProgramCommand<CourseId, CourseInput>,
  ): Promise<Result<Course, readonly ProgramSaveError[]>> {
    return this.saveCourse(command);
  }

  submitEvent(
    command: WriteProgramCommand<EventId, ShopEventInput>,
  ): Promise<Result<ShopEvent, readonly ProgramSaveError[]>> {
    return this.saveEvent(command);
  }
}
