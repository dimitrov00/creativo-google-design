import {
  DestroyRef,
  Injectable,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { combineLatest, map } from 'rxjs';
import type { Course, Position, ShopEvent, ShopLocation } from '@core/entities';
import type { PipelineError } from '@core/errors';
import {
  attachProgramImage,
  reorderCourses,
  reorderPositions,
  toggleCourseEnrollment,
  togglePositionStatus,
  writeCourse,
  writePosition,
  writePositionBody,
  writeShopEvent,
} from '@core/pipelines';
import {
  PositionId,
  Result,
  type LocationId,
  type ProgramImageId,
} from '@core/primitives';
import { ProgramImageSystem } from '@core/systems';
import { AccountStateService } from '@creativo/features/client/account-state';
import {
  CATALOG_PORTS,
  CLOCK_PORTS,
  DEFAULT_LOCATION_PORTS,
  ID_PORTS,
  LOCATION_LOAD_PORTS,
  PROGRAM_IMAGE_CALL_PORTS,
  PROGRAM_IMAGE_RESOLVE_PORTS,
  PROGRAMS_PORTS,
  STAGED_UPLOAD_PORTS,
} from '@creativo/infrastructure/firebase-app';
import { downscaleImage } from '@creativo/infrastructure/storage';

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
  private readonly staging = inject(STAGED_UPLOAD_PORTS);
  private readonly imageCalls = inject(PROGRAM_IMAGE_CALL_PORTS);
  private readonly imageReads = inject(PROGRAM_IMAGE_RESOLVE_PORTS);
  private readonly account = inject(AccountStateService);

  /**
   * The id a NEW role will take, drawn the moment it needs one — its first
   * picture goes into a folder named after it before the role is saved —
   * and used by that save; `null` while no new role has asked.
   */
  private draftId: PositionId | null = null;

  /** Every picture address this page has learned, by the picture's id. */
  private readonly addresses = signal<ReadonlyMap<string, string>>(new Map());
  /** The addresses made here for a picture just picked — released with the page. */
  private readonly previews: string[] = [];

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      for (const preview of this.previews) URL.revokeObjectURL(preview);
    });
  }

  /** The instant splitting upcoming from past events — read ONCE, at construction, never rolling (F4-8). */
  private readonly nowUtcMs = inject(CLOCK_PORTS).nowUtcMs();

  /** The three saves, one per kind — each the browser pipeline itself. */
  readonly submitPosition = writePosition({
    ...this.programs,
    // A new role whose pictures already have a folder takes that folder's id.
    nextId: () => this.draftId ?? this.ids.nextId(),
  });
  /** A role's description, judged and saved whole — or removed when blank. */
  readonly submitPositionBody = writePositionBody(this.programs);
  /** A role's description, read once when its sheet opens. */
  readonly loadPositionBody = this.programs.loadPositionBody;
  readonly submitCourse = writeCourse({ ...this.programs, ...this.ids });
  readonly submitEvent = writeShopEvent({
    ...this.programs,
    ...this.locations,
    ...this.defaultLocation,
    ...this.ids,
  });

  /** A picture's address by its id, for the editor; `null` until it is known. */
  readonly imageSource = computed(() => {
    const addresses = this.addresses();
    return (imageId: string): string | null => addresses.get(imageId) ?? null;
  });

  /** The id a new role will be saved under — the same one until {@link forgetDraft}. */
  draftPositionId(): PositionId {
    this.draftId ??= PositionId.of(this.ids.nextId());
    return this.draftId;
  }

  /** Another form opened: the next new role draws an id of its own. */
  forgetDraft(): void {
    this.draftId = null;
  }

  /**
   * A picture for a role's description: sized for the page here
   * (`ProgramImageSystem.LONG_EDGE`), then `attachProgramImage` — checked,
   * staged under the signed-in account and handed to the server. Once it
   * lands the editor shows it from the bytes already in hand.
   */
  async uploadPositionImage(
    positionId: PositionId,
    file: Blob,
  ): Promise<Result<ProgramImageId, PipelineError | null>> {
    const userId = this.account.userId();
    if (userId === null) return Result.err(null);
    const sized = await downscaleImage(file, ProgramImageSystem.LONG_EDGE);
    const answer = await attachProgramImage({
      ...this.staging,
      ...this.imageCalls,
      ...this.ids,
    })({
      userId,
      programId: positionId,
      image: sized.image,
      mediaWidth: sized.width,
      mediaHeight: sized.height,
    });
    if (!answer.ok) return answer;
    const preview = URL.createObjectURL(sized.image);
    this.previews.push(preview);
    this.learn(answer.value.imageId, preview);
    return Result.ok(answer.value.imageId);
  }

  /** The addresses of a stored description's pictures, each asked once. */
  async resolvePositionImages(
    positionId: PositionId,
    imageIds: readonly ProgramImageId[],
  ): Promise<void> {
    await Promise.all(
      imageIds
        .filter((imageId) => !this.addresses().has(imageId))
        .map(async (imageId) => {
          const address = await this.imageReads.resolveProgramImage(
            positionId,
            imageId,
          );
          if (address.ok) this.learn(imageId, address.value);
        }),
    );
  }

  private learn(imageId: ProgramImageId, address: string): void {
    this.addresses.update((known) => new Map(known).set(imageId, address));
  }

  /** A list's new order, as arranged: only the places that changed are written. */
  readonly reorderPositions = reorderPositions(this.programs);
  readonly reorderCourses = reorderCourses(this.programs);
  readonly togglePositionStatus = togglePositionStatus(this.programs);
  readonly toggleCourseEnrollment = toggleCourseEnrollment(this.programs);

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
}
