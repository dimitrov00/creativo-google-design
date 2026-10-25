import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { TranslocoDirective } from '@jsverse/transloco';
import {
  type CourseInput,
  EnrollmentStatus,
  type PositionInput,
  PositionStatus,
  ProgramInput,
  type ShopEventInput,
  WallTime,
} from '@core/components';
import type { Course, Position, ShopEvent } from '@core/entities';
import { UiButton, UiChip, UiTextField } from '@creativo/ui/controls';
import { UiStack } from '@creativo/ui/layout';
import {
  UiCard,
  UiListGroup,
  UiListRow,
  UiSectionHeader,
} from '@creativo/ui/patterns';
import { UiFrameDirective } from '@creativo/ui/modifiers';
import { AdminProgramsStore, ProgramsTab } from '../admin-programs.store';

/** Which program the edit form is open on — the field `programEditing`, the
 *  ONLY source of these strings (Law 6). */
const ProgramEditing = {
  /** A careers position. */
  Position: 'POSITION',
  /** A course. */
  Course: 'COURSE',
  /** A shop event. */
  Event: 'EVENT',
} as const;
type ProgramEditing = (typeof ProgramEditing)[keyof typeof ProgramEditing];

type PositionEditing = {
  readonly programEditing: typeof ProgramEditing.Position;
  readonly source: Position | null;
};
type CourseEditing = {
  readonly programEditing: typeof ProgramEditing.Course;
  readonly source: Course | null;
};
type EventEditing = {
  readonly programEditing: typeof ProgramEditing.Event;
  readonly source: ShopEvent | null;
};
type Editing = PositionEditing | CourseEditing | EventEditing | null;

/**
 * `/admin/programs` — the one place staff manage Positions/Courses/Events.
 * One page, one tab switcher (not three routes) since the three entities
 * share so much shape; list body is `ui-list-group`, status pickers are
 * `ui-chip` toggle pairs (no `ui-select` exists in the design system), and
 * the create/edit surface is an inline panel rather than a modal sheet —
 * `ModalSheetComponent` lives in `marketing-landing` and isn't part of its
 * public API, and pulling in the raw `ui-sheet` behavior wiring is more
 * ceremony than an internal tool needs.
 */
@Component({
  selector: 'lib-admin-programs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslocoDirective,
    UiButton,
    UiCard,
    UiChip,
    UiFrameDirective,
    UiListGroup,
    UiListRow,
    UiSectionHeader,
    UiStack,
    UiTextField,
  ],
  providers: [AdminProgramsStore],
  templateUrl: './admin-programs.html',
  styleUrl: './admin-programs.css',
  host: { class: 'lib-admin-programs', 'data-testid': 'admin-programs-page' },
})
export class AdminPrograms {
  protected readonly store = inject(AdminProgramsStore);
  private readonly title = inject(Title);

  /** The status dictionaries, for the chips — the template never spells a stored tag. */
  protected readonly PositionStatus = PositionStatus;
  protected readonly EnrollmentStatus = EnrollmentStatus;
  /*
   * The rows' trailing status text is today's lowercase word (F4-7), read
   * from the catalogue by its stored tag — `programs.status.position.<tag>`,
   * `programs.status.enrollment.<tag>` (pass E, E-17).
   */
  /** The edit form's program kinds, for the template. */
  protected readonly ProgramEditing = ProgramEditing;
  /** The tabs, for the template's chips and `@case`s (never bare literals). */
  protected readonly ProgramsTab = ProgramsTab;

  protected readonly tab = signal<ProgramsTab>(ProgramsTab.Positions);
  protected readonly editing = signal<Editing>(null);
  protected readonly saving = signal(false);
  protected readonly saveFailed = signal(false);

  // Position fields
  protected readonly positionTitleEn = signal('');
  protected readonly positionTitleBg = signal('');
  protected readonly positionSummaryEn = signal('');
  protected readonly positionSummaryBg = signal('');
  protected readonly positionStatus = signal<PositionStatus>(
    PositionStatus.Open,
  );
  protected readonly positionApplyUrl = signal('');
  protected readonly positionSortOrder = signal(0);

  // Course fields
  protected readonly courseTitleEn = signal('');
  protected readonly courseTitleBg = signal('');
  protected readonly courseDescriptionEn = signal('');
  protected readonly courseDescriptionBg = signal('');
  protected readonly courseEnrollmentStatus = signal<EnrollmentStatus>(
    EnrollmentStatus.Open,
  );
  protected readonly courseStartsLabelEn = signal('');
  protected readonly courseStartsLabelBg = signal('');
  protected readonly courseApplyUrl = signal('');
  protected readonly courseSortOrder = signal(0);

  // Event fields
  protected readonly eventTitleEn = signal('');
  protected readonly eventTitleBg = signal('');
  protected readonly eventDescriptionEn = signal('');
  protected readonly eventDescriptionBg = signal('');
  /** The shop wall clock as typed, `YYYY-MM-DDTHH:mm`. */
  protected readonly eventStartsAt = signal('');
  protected readonly eventLocationId = signal('');
  protected readonly eventApplyUrl = signal('');
  protected readonly eventSortOrder = signal(0);

  constructor() {
    this.title.setTitle('Programs · Creativo Admin');
  }

  protected setTab(next: ProgramsTab): void {
    this.tab.set(next);
    this.editing.set(null);
  }

  protected startCreate(): void {
    const tab = this.tab();
    if (tab === ProgramsTab.Positions) {
      this.fillPosition(ProgramInput.blankPosition());
      this.editing.set({
        programEditing: ProgramEditing.Position,
        source: null,
      });
    } else if (tab === ProgramsTab.Courses) {
      this.fillCourse(ProgramInput.blankCourse());
      this.editing.set({ programEditing: ProgramEditing.Course, source: null });
    } else {
      this.fillEvent(ProgramInput.blankShopEvent());
      this.editing.set({ programEditing: ProgramEditing.Event, source: null });
    }
    this.saveFailed.set(false);
  }

  protected startEditPosition(position: Position): void {
    this.fillPosition({ ...position, applyUrl: position.applyUrl ?? '' });
    this.editing.set({
      programEditing: ProgramEditing.Position,
      source: position,
    });
    this.saveFailed.set(false);
  }

  protected startEditCourse(course: Course): void {
    this.fillCourse({
      ...course,
      startsLabel: course.startsLabel ?? ProgramInput.blankCourse().startsLabel,
      applyUrl: course.applyUrl ?? '',
    });
    this.editing.set({ programEditing: ProgramEditing.Course, source: course });
    this.saveFailed.set(false);
  }

  protected startEditEvent(event: ShopEvent): void {
    this.fillEvent({
      ...event,
      // The shop wall clock as `<input type="datetime-local">` reads it
      // (`YYYY-MM-DDTHH:mm`) — the edit form's prefill (F4-11); parsing it
      // back is `ProgramsSystem`'s.
      startsAt: WallTime.toLocalIso(
        WallTime.of(event.localDate, event.startMinutes),
      ),
      locationId: event.locationId ?? '',
      applyUrl: event.applyUrl ?? '',
    });
    this.editing.set({ programEditing: ProgramEditing.Event, source: event });
    this.saveFailed.set(false);
  }

  protected cancelEdit(): void {
    this.editing.set(null);
    this.saveFailed.set(false);
  }

  protected async save(): Promise<void> {
    const editing = this.editing();
    if (!editing) return;
    this.saving.set(true);
    this.saveFailed.set(false);

    let succeeded: boolean;
    if (editing.programEditing === ProgramEditing.Position) {
      succeeded = await this.store.submitPosition({
        id: editing.source?.id ?? null,
        input: this.positionInput(),
      });
    } else if (editing.programEditing === ProgramEditing.Course) {
      succeeded = await this.store.submitCourse({
        id: editing.source?.id ?? null,
        input: this.courseInput(),
      });
    } else {
      succeeded = await this.store.submitEvent({
        id: editing.source?.id ?? null,
        input: this.eventInput(),
      });
    }

    this.saving.set(false);
    if (succeeded) {
      this.editing.set(null);
    } else {
      this.saveFailed.set(true);
    }
  }

  protected inputValue(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
  }

  protected numberValue(event: Event): number {
    return Number((event.target as HTMLInputElement).value) || 0;
  }

  /** Loads a form — a blank one to create, a stored one (absent optionals blank) to edit. */
  private fillPosition(input: PositionInput): void {
    this.positionTitleEn.set(input.title.en);
    this.positionTitleBg.set(input.title.bg);
    this.positionSummaryEn.set(input.summary.en);
    this.positionSummaryBg.set(input.summary.bg);
    this.positionStatus.set(input.positionStatus);
    this.positionApplyUrl.set(input.applyUrl);
    this.positionSortOrder.set(input.sortOrder);
  }

  private fillCourse(input: CourseInput): void {
    this.courseTitleEn.set(input.title.en);
    this.courseTitleBg.set(input.title.bg);
    this.courseDescriptionEn.set(input.description.en);
    this.courseDescriptionBg.set(input.description.bg);
    this.courseEnrollmentStatus.set(input.enrollmentStatus);
    this.courseStartsLabelEn.set(input.startsLabel.en);
    this.courseStartsLabelBg.set(input.startsLabel.bg);
    this.courseApplyUrl.set(input.applyUrl);
    this.courseSortOrder.set(input.sortOrder);
  }

  private fillEvent(input: ShopEventInput): void {
    this.eventTitleEn.set(input.title.en);
    this.eventTitleBg.set(input.title.bg);
    this.eventDescriptionEn.set(input.description.en);
    this.eventDescriptionBg.set(input.description.bg);
    this.eventStartsAt.set(input.startsAt);
    this.eventLocationId.set(input.locationId);
    this.eventApplyUrl.set(input.applyUrl);
    this.eventSortOrder.set(input.sortOrder);
  }

  /**
   * The role form as typed. The form has no location field, so every save
   * sends `locationIds: []` — an edit wipes stored ones, as before (F4-8).
   */
  private positionInput(): PositionInput {
    return {
      title: { en: this.positionTitleEn(), bg: this.positionTitleBg() },
      summary: { en: this.positionSummaryEn(), bg: this.positionSummaryBg() },
      locationIds: [],
      positionStatus: this.positionStatus(),
      applyUrl: this.positionApplyUrl(),
      sortOrder: this.positionSortOrder(),
    };
  }

  private courseInput(): CourseInput {
    return {
      title: { en: this.courseTitleEn(), bg: this.courseTitleBg() },
      description: {
        en: this.courseDescriptionEn(),
        bg: this.courseDescriptionBg(),
      },
      enrollmentStatus: this.courseEnrollmentStatus(),
      startsLabel: {
        en: this.courseStartsLabelEn(),
        bg: this.courseStartsLabelBg(),
      },
      applyUrl: this.courseApplyUrl(),
      sortOrder: this.courseSortOrder(),
    };
  }

  private eventInput(): ShopEventInput {
    return {
      title: { en: this.eventTitleEn(), bg: this.eventTitleBg() },
      description: {
        en: this.eventDescriptionEn(),
        bg: this.eventDescriptionBg(),
      },
      startsAt: this.eventStartsAt(),
      locationId: this.eventLocationId(),
      applyUrl: this.eventApplyUrl(),
      sortOrder: this.eventSortOrder(),
    };
  }
}
