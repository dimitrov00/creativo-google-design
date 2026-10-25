import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { EnrollmentStatus, LocalizedText } from '@core/components';
import type { Course } from '@core/entities';
import { Locale, Tag } from '@core/primitives';
import { ProgramsSystem } from '@core/systems';
import { COURSE_READ_PORTS } from '@creativo/infrastructure/firebase-app';
import {
  SiteFooterComponent,
  SiteHeaderComponent,
} from '@creativo/features/shared/shell';
import {
  UiBadge,
  UiBadgeTone,
  UiButton,
  UiChip,
  UiIcon,
  UiSkeleton,
} from '@creativo/ui/controls';
import { UiStack } from '@creativo/ui/layout';
import {
  UiCard,
  UiListGroup,
  UiListRow,
  UiSectionHeader,
} from '@creativo/ui/patterns';
import { UiFrameDirective, UiTextDirective } from '@creativo/ui/modifiers';
import { LoadSlice, LoadState } from '@creativo/shared/view-state';

type CoursesTab =
  typeof EnrollmentStatus.Open | typeof EnrollmentStatus.Upcoming;

/**
 * What the page lists — every course but a closed one (index #11's `in`
 * filter): the statuses in dictionary order, kept by the rule's one home
 * (`ProgramsSystem.isEnrollmentOpenOrUpcoming`).
 */
const LISTED_STATUSES: readonly EnrollmentStatus[] = Tag.values(
  EnrollmentStatus,
).filter((status) => ProgramsSystem.isEnrollmentOpenOrUpcoming(status));

const INSTAGRAM_URL = 'https://instagram.com/creativo.barbershop';

const STATUS_TONES = {
  [EnrollmentStatus.Open]: 'accent',
  [EnrollmentStatus.Upcoming]: 'warning',
  [EnrollmentStatus.Closed]: 'neutral',
} as const satisfies Record<EnrollmentStatus, UiBadgeTone>;

/** `/courses` — public browse page for open/upcoming courses, replacing
 *  the landing courses teaser's Instagram-only CTA. Same shape as
 *  `MarketingCareers` (one live read, `COURSE_READ_PORTS`, open and
 *  upcoming courses) plus a client-side tab split (Open/Upcoming),
 *  hand-rolled with `ui-chip` exactly like `client-appointments`'
 *  list/calendar toggle — no dedicated tabs primitive exists in the design
 *  system yet. Chrome is the real site header/footer, solid
 *  (`uiOverHero=false`). */
@Component({
  selector: 'cr-marketing-courses',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SiteFooterComponent,
    SiteHeaderComponent,
    TranslocoDirective,
    UiBadge,
    UiButton,
    UiCard,
    UiChip,
    UiFrameDirective,
    UiIcon,
    UiListGroup,
    UiListRow,
    UiSectionHeader,
    UiSkeleton,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './marketing-courses.html',
  styleUrl: './marketing-courses.css',
  host: { 'data-testid': 'courses-page' },
})
export class MarketingCourses {
  private readonly courses = inject(COURSE_READ_PORTS);
  private readonly transloco = inject(TranslocoService);
  private readonly title = inject(Title);

  protected readonly instagramUrl = INSTAGRAM_URL;
  /** The dictionary, for the template's tab chips (never bare literals). */
  protected readonly EnrollmentStatus = EnrollmentStatus;
  /** The dictionary, for the template's `@case`s (never bare literals). */
  protected readonly LoadState = LoadState;
  protected readonly tab = signal<CoursesTab>(EnrollmentStatus.Open);

  private readonly result = toSignal(
    this.courses.observeCourses(LISTED_STATUSES),
    { initialValue: undefined },
  );

  protected readonly state = computed<LoadSlice<readonly Course[]>>(() => {
    const result = this.result();
    if (result === undefined) return LoadSlice.loading;
    if (!result.ok) return LoadSlice.failed;
    return LoadSlice.ready(result.value);
  });

  protected readonly visibleCourses = computed<readonly Course[]>(() => {
    const state = this.state();
    if (state.loadState !== LoadState.Ready) return [];
    return state.data.filter(
      (course) => course.enrollmentStatus === this.tab(),
    );
  });

  constructor() {
    this.title.setTitle('Courses · Creativo');
  }

  protected setTab(next: CoursesTab): void {
    this.tab.set(next);
  }

  /** The active language's string — `bg` for every language but `en`. */
  protected text(localized: LocalizedText): string {
    return LocalizedText.pick(
      localized,
      this.transloco.getActiveLang() === Locale.En ? Locale.En : Locale.Bg,
    );
  }

  protected applyHref(course: Course): string {
    return course.applyUrl ?? this.instagramUrl;
  }

  protected statusTone(enrollmentStatus: EnrollmentStatus): UiBadgeTone {
    // eslint-disable-next-line security/detect-object-injection -- closed union.
    return STATUS_TONES[enrollmentStatus];
  }
}
