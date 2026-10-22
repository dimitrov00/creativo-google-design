import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { combineLatest, map } from 'rxjs';
import type {
  CourseInput,
  PositionInput,
  ShopEventInput,
} from '@core/components';
import type { Course, Position, ShopEvent } from '@core/entities';
import {
  type WriteProgramCommand,
  writeCourse,
  writePosition,
  writeShopEvent,
} from '@core/pipelines';
import type { CourseId, EventId, PositionId } from '@core/primitives';
import {
  CLOCK_PORTS,
  DEFAULT_LOCATION_PORTS,
  ID_PORTS,
  LOCATION_LOAD_PORTS,
  PROGRAMS_PORTS,
} from '@creativo/infrastructure/firebase-app';

export type ProgramsTab = 'positions' | 'courses' | 'events';

/**
 * Page-scoped store for `/admin/programs` — the three live lists and one
 * save per kind. Component-provided, not root: nothing outside this screen
 * needs admin content-management state.
 *
 * Programs content stays a rules-guarded admin write (D9(b)), so each save
 * is a browser pipeline of `@core/pipelines` over the programs suite: it
 * reads the stored document on an update (and, for an event, the shop
 * whose zone places it), lets `ProgramsSystem` judge the form, and writes
 * the flat entity whole. The page reads only whether it saved.
 */
@Injectable()
export class AdminProgramsStore {
  private readonly programs = inject(PROGRAMS_PORTS);
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

  async submitPosition(
    command: WriteProgramCommand<PositionId, PositionInput>,
  ): Promise<boolean> {
    return (await this.savePosition(command)).ok;
  }

  async submitCourse(
    command: WriteProgramCommand<CourseId, CourseInput>,
  ): Promise<boolean> {
    return (await this.saveCourse(command)).ok;
  }

  async submitEvent(
    command: WriteProgramCommand<EventId, ShopEventInput>,
  ): Promise<boolean> {
    return (await this.saveEvent(command)).ok;
  }
}
