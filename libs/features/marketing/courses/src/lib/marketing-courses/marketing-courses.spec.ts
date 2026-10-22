import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EnvironmentProviders, Injectable } from '@angular/core';
import {
  Translation,
  TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import { AVATAR_UPLOADER } from '@creativo/application/accounts';
import {
  APPOINTMENT_READ_PORTS,
  COURSE_READ_PORTS,
  INBOX_PORTS,
  PROFILE_PORTS,
} from '@creativo/infrastructure/firebase-app';
import { EnrollmentStatus } from '@core/components';
import type { Course } from '@core/entities';
import type { CourseReadPorts } from '@core/ports';
import {
  courseOf,
  memoryAppointmentReadPorts,
  memoryCourseReadPorts,
  memoryInboxPorts,
  memoryProfilePorts,
  memoryProgramsWorld,
} from '@core/testing';
import { AUTH_GATEWAY, ok } from '@creativo/application/identity';
import { MarketingCourses } from './marketing-courses';

function course(id: string, enrollmentStatus: EnrollmentStatus): Course {
  return courseOf(id, { enrollmentStatus });
}

@Injectable()
class TestTranslationLoader implements TranslocoLoader {
  getTranslation(): Observable<Translation> {
    return of({});
  }
}

function provideTestI18n(): EnvironmentProviders[] {
  return provideTransloco({
    config: {
      availableLangs: ['bg', 'en'],
      defaultLang: 'en',
      fallbackLang: 'en',
      missingHandler: { logMissingKey: false },
    },
    loader: TestTranslationLoader,
  });
}

/**
 * The page's read over the memory double (`enrollmentStatus in` the asked
 * statuses, `sortOrder` then id), every list of statuses it asks for
 * recorded in `asked`.
 */
function recordedCourseReads(
  courses: readonly Course[],
  asked: (readonly EnrollmentStatus[] | null)[],
): CourseReadPorts {
  const reads = memoryCourseReadPorts(memoryProgramsWorld({ courses }));
  return {
    observeCourses: (statuses) => {
      asked.push(statuses);
      return reads.observeCourses(statuses);
    },
  };
}

async function configure(
  courses: readonly Course[],
  asked: (readonly EnrollmentStatus[] | null)[] = [],
): Promise<ComponentFixture<MarketingCourses>> {
  await TestBed.configureTestingModule({
    imports: [MarketingCourses],
    providers: [
      provideRouter([]),
      ...provideTestI18n(),
      {
        provide: COURSE_READ_PORTS,
        useValue: recordedCourseReads(courses, asked),
      },
      {
        provide: AUTH_GATEWAY,
        useValue: { observePrincipal: () => of({ kind: 'anonymous' }) },
      },
      // The shared header's account circle reads its photo off the
      // session identity — no avatar for an anonymous visitor.
      {
        provide: AVATAR_UPLOADER,
        useValue: { find: () => Promise.resolve(ok(null)) },
      },
      // The shared session model behind that chrome reads the profile.
      { provide: PROFILE_PORTS, useValue: memoryProfilePorts(new Map()) },
      // …and its menu counts upcoming visits.
      {
        // The shell menu's notifications row reads the inbox.
        provide: INBOX_PORTS,
        useValue: memoryInboxPorts(new Map()),
      },
      {
        provide: APPOINTMENT_READ_PORTS,
        useValue: memoryAppointmentReadPorts([]),
      },
    ],
  }).compileComponents();

  return TestBed.createComponent(MarketingCourses);
}

describe('MarketingCourses', () => {
  it('defaults to the Open tab and shows its empty state when nothing is open', async () => {
    const fixture = await configure([
      course('course_1', EnrollmentStatus.Upcoming),
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('[data-testid="courses-empty"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="courses-list"]')).toBeNull();
  });

  it('switches to the Upcoming tab and lists upcoming courses', async () => {
    const fixture = await configure([
      course('course_1', EnrollmentStatus.Upcoming),
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    (
      host.querySelector(
        '[data-testid="courses-tab-upcoming"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    const list = host.querySelector('[data-testid="courses-list"]');
    expect(list).not.toBeNull();
    expect(list?.querySelectorAll('a[uilistrow]').length).toBe(1);
  });

  it('lists open courses on the default tab', async () => {
    const asked: (readonly EnrollmentStatus[] | null)[] = [];
    const fixture = await configure(
      [
        course('course_1', EnrollmentStatus.Open),
        course('course_2', EnrollmentStatus.Upcoming),
      ],
      asked,
    );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    const list = host.querySelector('[data-testid="courses-list"]');
    expect(list?.querySelectorAll('a[uilistrow]').length).toBe(1);
    // One read, open and upcoming courses — a closed one is never asked for.
    expect(asked).toEqual([[EnrollmentStatus.Open, EnrollmentStatus.Upcoming]]);
  });

  it('badges an open course with an accent tone', async () => {
    const fixture = await configure([
      course('course_1', EnrollmentStatus.Open),
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    const badge = host.querySelector(
      '[data-testid="courses-list"] a[uilistrow] [uibadge]',
    );
    expect(badge?.getAttribute('data-tone')).toBe('accent');
  });

  // Flip 4, F4-7: the stored status is SCREAMING (`UPCOMING`); the badge
  // still prints today's lowercase word, in today's tone.
  it('badges an upcoming course "upcoming" with a warning tone', async () => {
    const fixture = await configure([
      course('course_1', EnrollmentStatus.Upcoming),
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    (
      host.querySelector(
        '[data-testid="courses-tab-upcoming"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    const badge = host.querySelector(
      '[data-testid="courses-list"] a[uilistrow] [uibadge]',
    );
    expect(badge?.textContent?.trim()).toBe('upcoming');
    expect(badge?.getAttribute('data-tone')).toBe('warning');
  });

  it('prints the badge text "open" for an open course', async () => {
    const fixture = await configure([
      course('course_1', EnrollmentStatus.Open),
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    const badge = host.querySelector(
      '[data-testid="courses-list"] a[uilistrow] [uibadge]',
    );
    expect(badge?.textContent?.trim()).toBe('open');
  });
});
