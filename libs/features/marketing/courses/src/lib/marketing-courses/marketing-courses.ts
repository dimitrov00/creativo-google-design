import { enrollmentStatusWords } from '@creativo/infrastructure/i18n';
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
  ENROLLMENT_STATUSES,
  EnrollmentStatus,
  LocalizedText,
  isEnrollmentOpenOrUpcoming,
} from '@core/components';
import type { Course } from '@core/entities';
import { Locale } from '@core/primitives';
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

type CoursesListState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ready'; readonly courses: readonly Course[] };

type CoursesTab =
  typeof EnrollmentStatus.Open | typeof EnrollmentStatus.Upcoming;

/** What the page lists — every course but a closed one (index #11's `in` filter). */
const LISTED_STATUSES: readonly EnrollmentStatus[] = ENROLLMENT_STATUSES.filter(
  isEnrollmentOpenOrUpcoming,
);

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
  protected readonly tab = signal<CoursesTab>(EnrollmentStatus.Open);

  private readonly result = toSignal(
    this.courses.observeCourses(LISTED_STATUSES),
    { initialValue: undefined },
  );

  protected readonly state = computed<CoursesListState>(() => {
    const result = this.result();
    if (result === undefined) return { kind: 'loading' };
    if (!result.ok) return { kind: 'error' };
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

  protected statusWord(enrollmentStatus: EnrollmentStatus): string {
    // eslint-disable-next-line security/detect-object-injection -- closed union.
    return enrollmentStatusWords[enrollmentStatus];
  }
}
