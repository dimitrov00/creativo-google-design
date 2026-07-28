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
import {
  Course,
  CourseEnrollmentStatus,
  COURSE_REPOSITORY,
  ObserveCoursesUseCase,
} from '@creativo/application/programs';
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

type CoursesListState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ready'; readonly courses: readonly Course[] };

type CoursesTab = Extract<CourseEnrollmentStatus, 'open' | 'upcoming'>;

const INSTAGRAM_URL = 'https://instagram.com/creativo.barbershop';

const STATUS_TONES: Record<CourseEnrollmentStatus, UiBadgeTone> = {
  open: 'accent',
  upcoming: 'warning',
  closed: 'neutral',
};

/** `/courses` — public browse page for open/upcoming courses, replacing
 *  the landing courses teaser's Instagram-only CTA. Same shape as
 *  `MarketingCareers` plus a tab split (Open/Upcoming), hand-rolled with
 *  `ui-chip` exactly like `client-appointments`' list/calendar toggle —
 *  no dedicated tabs primitive exists in the design system yet. Chrome is
 *  the real site header/footer, solid (`uiOverHero=false`). */
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
  private readonly courseRepository = inject(COURSE_REPOSITORY);
  private readonly observeCoursesUseCase = new ObserveCoursesUseCase(
    this.courseRepository,
  );
  private readonly transloco = inject(TranslocoService);
  private readonly title = inject(Title);

  protected readonly instagramUrl = INSTAGRAM_URL;
  protected readonly tab = signal<CoursesTab>('open');

  private readonly result = toSignal(this.observeCoursesUseCase.execute(), {
    initialValue: undefined,
  });

  protected readonly state = computed<CoursesListState>(() => {
    const result = this.result();
    if (result === undefined) return { kind: 'loading' };
    if (result.isFailure()) return { kind: 'error' };
    return { kind: 'ready', courses: result.value };
  });

  protected readonly visibleCourses = computed<readonly Course[]>(() => {
    const state = this.state();
    if (state.kind !== 'ready') return [];
    return state.courses.filter(
      (course) => course.enrollmentStatus === this.tab(),
    );
  });

  constructor() {
    this.title.setTitle('Courses · Creativo');
  }

  protected setTab(next: CoursesTab): void {
    this.tab.set(next);
  }

  protected text(localized: { get(locale: 'en' | 'bg'): string }): string {
    return localized.get(this.transloco.getActiveLang() as 'en' | 'bg');
  }

  protected applyHref(course: Course): string {
    return course.applyUrl ?? this.instagramUrl;
  }

  protected statusTone(status: CourseEnrollmentStatus): UiBadgeTone {
    return STATUS_TONES[status];
  }
}
