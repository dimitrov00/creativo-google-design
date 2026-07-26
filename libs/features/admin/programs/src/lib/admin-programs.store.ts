import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { combineLatest, map } from 'rxjs';
import {
  COURSE_REPOSITORY,
  Course,
  CourseEnrollmentStatus,
  CourseId,
  CreateCourseUseCase,
  CreatePositionUseCase,
  CreateShopEventUseCase,
  ObserveAllCoursesUseCase,
  ObserveAllPositionsUseCase,
  ObservePastShopEventsUseCase,
  ObserveUpcomingShopEventsUseCase,
  POSITION_REPOSITORY,
  Position,
  PositionId,
  PositionStatus,
  Result,
  SHOP_EVENT_REPOSITORY,
  ShopEvent,
  ShopEventId,
  UpdateCourseUseCase,
  UpdatePositionUseCase,
  UpdateShopEventUseCase,
  combine,
  fail,
  ok,
} from '@creativo/application/programs';
import { ID_GENERATOR, RepositoryError } from '@creativo/application/shared';

export type ProgramsTab = 'positions' | 'courses' | 'events';

export interface LocalizedInput {
  readonly en: string;
  readonly bg: string;
}

export interface PositionFormInput {
  readonly id: PositionId | null;
  readonly title: LocalizedInput;
  readonly summary: LocalizedInput;
  readonly status: PositionStatus;
  readonly applyUrl: string;
  readonly sortOrder: number;
}

export interface CourseFormInput {
  readonly id: CourseId | null;
  readonly title: LocalizedInput;
  readonly description: LocalizedInput;
  readonly enrollmentStatus: CourseEnrollmentStatus;
  readonly startsLabel: LocalizedInput;
  readonly applyUrl: string;
  readonly sortOrder: number;
}

export interface ShopEventFormInput {
  readonly id: ShopEventId | null;
  readonly title: LocalizedInput;
  readonly description: LocalizedInput;
  readonly startDateIso: string;
  readonly locationId: string;
  readonly applyUrl: string;
  readonly sortOrder: number;
}

/** The zone every shop event/course/position on this product is scheduled in — matches `SCHEDULING_ZONE` in `CreateBookingUseCase` and the Firestore event adapter. */
const PROGRAMS_ZONE = 'Europe/Sofia';

function toResultUndefinedIfEmpty(value: string): string | undefined {
  return value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Page-scoped store for `/admin/programs` — mirrors `AppointmentsStore`'s
 * shape (live lists via `toSignal(useCase.execute())`), plus one
 * create/update pair per entity. Component-provided, not root: nothing
 * outside this screen needs admin content-management state.
 */
@Injectable()
export class AdminProgramsStore {
  private readonly positionRepository = inject(POSITION_REPOSITORY);
  private readonly courseRepository = inject(COURSE_REPOSITORY);
  private readonly eventRepository = inject(SHOP_EVENT_REPOSITORY);
  private readonly idGenerator = inject(ID_GENERATOR);

  private readonly observeAllPositions = new ObserveAllPositionsUseCase(
    this.positionRepository,
  );
  private readonly observeAllCourses = new ObserveAllCoursesUseCase(
    this.courseRepository,
  );
  private readonly observeUpcomingEvents = new ObserveUpcomingShopEventsUseCase(
    this.eventRepository,
  );
  private readonly observePastEvents = new ObservePastShopEventsUseCase(
    this.eventRepository,
  );

  private readonly createPositionUseCase = new CreatePositionUseCase(
    this.positionRepository,
    this.idGenerator,
  );
  private readonly updatePositionUseCase = new UpdatePositionUseCase(
    this.positionRepository,
  );
  private readonly createCourseUseCase = new CreateCourseUseCase(
    this.courseRepository,
    this.idGenerator,
  );
  private readonly updateCourseUseCase = new UpdateCourseUseCase(
    this.courseRepository,
  );
  private readonly createEventUseCase = new CreateShopEventUseCase(
    this.eventRepository,
    this.idGenerator,
  );
  private readonly updateEventUseCase = new UpdateShopEventUseCase(
    this.eventRepository,
  );

  private readonly positionsResult = toSignal(
    this.observeAllPositions.execute(),
    {
      initialValue: undefined,
    },
  );
  readonly positions = computed<readonly Position[]>(() => {
    const result = this.positionsResult();
    return result?.isSuccess() ? result.value : [];
  });

  private readonly coursesResult = toSignal(this.observeAllCourses.execute(), {
    initialValue: undefined,
  });
  readonly courses = computed<readonly Course[]>(() => {
    const result = this.coursesResult();
    return result?.isSuccess() ? result.value : [];
  });

  private readonly eventsResult = toSignal(
    combineLatest([
      this.observeUpcomingEvents.execute(),
      this.observePastEvents.execute(),
    ]).pipe(
      map(([upcoming, past]): Result<readonly ShopEvent[], RepositoryError> =>
        combineEventPages(upcoming, past),
      ),
    ),
    { initialValue: undefined },
  );
  readonly events = computed<readonly ShopEvent[]>(() => {
    const result = this.eventsResult();
    return result?.isSuccess() ? result.value : [];
  });

  async submitPosition(input: PositionFormInput): Promise<boolean> {
    const props = {
      title: input.title,
      summary: input.summary,
      locationIds: [],
      status: input.status,
      applyUrl: toResultUndefinedIfEmpty(input.applyUrl),
      sortOrder: input.sortOrder,
    };
    const result = input.id
      ? await this.updatePositionUseCase.execute({ id: input.id, ...props })
      : await this.createPositionUseCase.execute(props);
    return result.isSuccess();
  }

  async submitCourse(input: CourseFormInput): Promise<boolean> {
    const props = {
      title: input.title,
      description: input.description,
      enrollmentStatus: input.enrollmentStatus,
      startsLabel:
        toResultUndefinedIfEmpty(input.startsLabel.en) !== undefined ||
        toResultUndefinedIfEmpty(input.startsLabel.bg) !== undefined
          ? input.startsLabel
          : undefined,
      applyUrl: toResultUndefinedIfEmpty(input.applyUrl),
      sortOrder: input.sortOrder,
    };
    const result = input.id
      ? await this.updateCourseUseCase.execute({ id: input.id, ...props })
      : await this.createCourseUseCase.execute(props);
    return result.isSuccess();
  }

  async submitEvent(input: ShopEventFormInput): Promise<boolean> {
    const props = {
      title: input.title,
      description: input.description,
      startDateIso: input.startDateIso,
      timezone: PROGRAMS_ZONE,
      locationId: toResultUndefinedIfEmpty(input.locationId),
      applyUrl: toResultUndefinedIfEmpty(input.applyUrl),
      sortOrder: input.sortOrder,
    };
    const result = input.id
      ? await this.updateEventUseCase.execute({ id: input.id, ...props })
      : await this.createEventUseCase.execute(props);
    return result.isSuccess();
  }
}

function combineEventPages(
  upcoming: Result<readonly ShopEvent[], RepositoryError>,
  past: Result<readonly ShopEvent[], RepositoryError>,
): Result<readonly ShopEvent[], RepositoryError> {
  const combined = combine([upcoming, past]);
  if (combined.isFailure()) {
    return fail(combined.error[0] as RepositoryError);
  }
  return ok(combined.value.flat());
}
