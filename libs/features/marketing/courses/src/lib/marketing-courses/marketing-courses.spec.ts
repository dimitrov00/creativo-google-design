import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EnvironmentProviders, Injectable } from '@angular/core';
import {
  Translation,
  TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import { AVATAR_UPLOADER, PROFILE_PORT } from '@creativo/application/accounts';
import { APPOINTMENT_REPOSITORY } from '@creativo/application/booking';
import { AUTH_GATEWAY } from '@creativo/application/identity';
import {
  COURSE_REPOSITORY,
  Course,
  CourseEnrollmentStatus,
  CourseRepository,
  Result,
  ok,
} from '@creativo/application/programs';
import { MarketingCourses } from './marketing-courses';

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

function course(id: string, enrollmentStatus: CourseEnrollmentStatus): Course {
  return unwrap(
    Course.create({
      id,
      title: { en: 'Fundamentals of Fading', bg: 'Основи на фейда' },
      description: { en: 'Six-week evening course', bg: 'Шестседмичен курс' },
      enrollmentStatus,
      sortOrder: 0,
    }),
  );
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

function repositoryStub(courses: readonly Course[]): CourseRepository {
  return {
    findById: async () => ok(courses[0] ?? null),
    save: async () => ok(undefined),
    observeOpenAndUpcoming: () => of(ok(courses)),
    observeAll: () => of(ok(courses)),
  };
}

async function configure(
  courses: readonly Course[],
): Promise<ComponentFixture<MarketingCourses>> {
  await TestBed.configureTestingModule({
    imports: [MarketingCourses],
    providers: [
      provideRouter([]),
      ...provideTestI18n(),
      { provide: COURSE_REPOSITORY, useValue: repositoryStub(courses) },
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
      {
        provide: PROFILE_PORT,
        useValue: { getProfile: () => Promise.resolve(ok(null)) },
      },
      // …and its menu counts upcoming visits.
      {
        provide: APPOINTMENT_REPOSITORY,
        useValue: { observeUpcomingFor: () => of(ok([])) },
      },
    ],
  }).compileComponents();

  return TestBed.createComponent(MarketingCourses);
}

describe('MarketingCourses', () => {
  it('defaults to the Open tab and shows its empty state when nothing is open', async () => {
    const fixture = await configure([course('course_1', 'upcoming')]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('[data-testid="courses-empty"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="courses-list"]')).toBeNull();
  });

  it('switches to the Upcoming tab and lists upcoming courses', async () => {
    const fixture = await configure([course('course_1', 'upcoming')]);
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
    const fixture = await configure([
      course('course_1', 'open'),
      course('course_2', 'upcoming'),
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    const list = host.querySelector('[data-testid="courses-list"]');
    expect(list?.querySelectorAll('a[uilistrow]').length).toBe(1);
  });

  it('badges an open course with an accent tone', async () => {
    const fixture = await configure([course('course_1', 'open')]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    const badge = host.querySelector(
      '[data-testid="courses-list"] a[uilistrow] [uibadge]',
    );
    expect(badge?.getAttribute('data-tone')).toBe('accent');
  });
});
