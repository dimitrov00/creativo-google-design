import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { TranslocoDirective } from '@jsverse/transloco';
import {
  Course,
  CourseEnrollmentStatus,
  Position,
  PositionStatus,
  ShopEvent,
} from '@creativo/application/programs';
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

type PositionEditing = {
  readonly kind: 'position';
  readonly source: Position | null;
};
type CourseEditing = {
  readonly kind: 'course';
  readonly source: Course | null;
};
type EventEditing = {
  readonly kind: 'event';
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

  protected readonly tab = signal<ProgramsTab>('positions');
  protected readonly editing = signal<Editing>(null);
  protected readonly saving = signal(false);
  protected readonly saveFailed = signal(false);

  // Position fields
  protected readonly positionTitleEn = signal('');
  protected readonly positionTitleBg = signal('');
  protected readonly positionSummaryEn = signal('');
  protected readonly positionSummaryBg = signal('');
  protected readonly positionStatus = signal<PositionStatus>('open');
  protected readonly positionApplyUrl = signal('');
  protected readonly positionSortOrder = signal(0);

  // Course fields
  protected readonly courseTitleEn = signal('');
  protected readonly courseTitleBg = signal('');
  protected readonly courseDescriptionEn = signal('');
  protected readonly courseDescriptionBg = signal('');
  protected readonly courseEnrollmentStatus =
    signal<CourseEnrollmentStatus>('open');
  protected readonly courseStartsLabelEn = signal('');
  protected readonly courseStartsLabelBg = signal('');
  protected readonly courseApplyUrl = signal('');
  protected readonly courseSortOrder = signal(0);

  // Event fields
  protected readonly eventTitleEn = signal('');
  protected readonly eventTitleBg = signal('');
  protected readonly eventDescriptionEn = signal('');
  protected readonly eventDescriptionBg = signal('');
  protected readonly eventStartDateIso = signal('');
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
    if (tab === 'positions') {
      this.positionTitleEn.set('');
      this.positionTitleBg.set('');
      this.positionSummaryEn.set('');
      this.positionSummaryBg.set('');
      this.positionStatus.set('open');
      this.positionApplyUrl.set('');
      this.positionSortOrder.set(0);
      this.editing.set({ kind: 'position', source: null });
    } else if (tab === 'courses') {
      this.courseTitleEn.set('');
      this.courseTitleBg.set('');
      this.courseDescriptionEn.set('');
      this.courseDescriptionBg.set('');
      this.courseEnrollmentStatus.set('open');
      this.courseStartsLabelEn.set('');
      this.courseStartsLabelBg.set('');
      this.courseApplyUrl.set('');
      this.courseSortOrder.set(0);
      this.editing.set({ kind: 'course', source: null });
    } else {
      this.eventTitleEn.set('');
      this.eventTitleBg.set('');
      this.eventDescriptionEn.set('');
      this.eventDescriptionBg.set('');
      this.eventStartDateIso.set('');
      this.eventLocationId.set('');
      this.eventApplyUrl.set('');
      this.eventSortOrder.set(0);
      this.editing.set({ kind: 'event', source: null });
    }
    this.saveFailed.set(false);
  }

  protected startEditPosition(position: Position): void {
    this.positionTitleEn.set(position.title.en);
    this.positionTitleBg.set(position.title.bg);
    this.positionSummaryEn.set(position.summary.en);
    this.positionSummaryBg.set(position.summary.bg);
    this.positionStatus.set(position.status);
    this.positionApplyUrl.set(position.applyUrl ?? '');
    this.positionSortOrder.set(position.sortOrder);
    this.editing.set({ kind: 'position', source: position });
    this.saveFailed.set(false);
  }

  protected startEditCourse(course: Course): void {
    this.courseTitleEn.set(course.title.en);
    this.courseTitleBg.set(course.title.bg);
    this.courseDescriptionEn.set(course.description.en);
    this.courseDescriptionBg.set(course.description.bg);
    this.courseEnrollmentStatus.set(course.enrollmentStatus);
    this.courseStartsLabelEn.set(course.startsLabel?.en ?? '');
    this.courseStartsLabelBg.set(course.startsLabel?.bg ?? '');
    this.courseApplyUrl.set(course.applyUrl ?? '');
    this.courseSortOrder.set(course.sortOrder);
    this.editing.set({ kind: 'course', source: course });
    this.saveFailed.set(false);
  }

  protected startEditEvent(event: ShopEvent): void {
    this.eventTitleEn.set(event.title.en);
    this.eventTitleBg.set(event.title.bg);
    this.eventDescriptionEn.set(event.description.en);
    this.eventDescriptionBg.set(event.description.bg);
    this.eventStartDateIso.set(event.startDate.toISO().slice(0, 16));
    this.eventLocationId.set(event.locationId?.value ?? '');
    this.eventApplyUrl.set(event.applyUrl ?? '');
    this.eventSortOrder.set(event.sortOrder);
    this.editing.set({ kind: 'event', source: event });
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
    if (editing.kind === 'position') {
      succeeded = await this.store.submitPosition({
        id: editing.source?.id ?? null,
        title: { en: this.positionTitleEn(), bg: this.positionTitleBg() },
        summary: { en: this.positionSummaryEn(), bg: this.positionSummaryBg() },
        status: this.positionStatus(),
        applyUrl: this.positionApplyUrl(),
        sortOrder: this.positionSortOrder(),
      });
    } else if (editing.kind === 'course') {
      succeeded = await this.store.submitCourse({
        id: editing.source?.id ?? null,
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
      });
    } else {
      succeeded = await this.store.submitEvent({
        id: editing.source?.id ?? null,
        title: { en: this.eventTitleEn(), bg: this.eventTitleBg() },
        description: {
          en: this.eventDescriptionEn(),
          bg: this.eventDescriptionBg(),
        },
        startDateIso: this.eventStartDateIso(),
        locationId: this.eventLocationId(),
        applyUrl: this.eventApplyUrl(),
        sortOrder: this.eventSortOrder(),
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
}
