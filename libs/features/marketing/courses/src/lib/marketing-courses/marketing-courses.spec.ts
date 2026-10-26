import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EnvironmentProviders, Injectable } from '@angular/core';
import {
  Translation,
  TranslocoLoader,
  TranslocoService,
  provideTransloco,
} from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import {
  APPOINTMENT_READ_PORTS,
  AUTH_SESSION_PORTS,
  AVATAR_PORTS,
  CLOCK_PORTS,
  COURSE_READ_PORTS,
  DEFAULT_LOCATION_PORTS,
  INBOX_PORTS,
  LOCATION_LOAD_PORTS,
  PROFILE_PORTS,
} from '@creativo/infrastructure/firebase-app';
import { EnrollmentStatus } from '@core/components';
import type { Course } from '@core/entities';
import type { CourseReadPorts } from '@core/ports';
import {
  courseOf,
  locationFixture,
  memoryAppointmentReadPorts,
  memoryAuthSessionPorts,
  memoryAvatarPorts,
  memoryClockPorts,
  memoryCourseReadPorts,
  memoryDefaultLocationPorts,
  memoryInboxPorts,
  memoryLocationLoadPorts,
  memoryProfilePorts,
  memoryProgramsWorld,
} from '@core/testing';
import { LanguageService } from '@creativo/features/shared/shell';
import { MarketingCourses } from './marketing-courses';

function course(id: string, enrollmentStatus: EnrollmentStatus): Course {
  return courseOf(id, { enrollmentStatus });
}

/**
 * The app's own `programs.status` words for `lang` — read, never re-typed, so
 * the badge cases pin the catalogue's words (E-17, translated by OR-53).
 * Every other key renders as itself.
 */
function programStatusWords(lang: string): Translation {
  const file = resolve(
    __dirname,
    `../../../../../../infrastructure/i18n/src/assets/i18n/${lang}.json`,
  );
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed path to the app's own catalogue.
  const catalogue = JSON.parse(readFileSync(file, 'utf8')) as {
    readonly programs: { readonly status: Translation };
  };
  return { programs: { status: catalogue.programs.status } };
}

@Injectable()
class TestTranslationLoader implements TranslocoLoader {
  getTranslation(lang: string): Observable<Translation> {
    return of(programStatusWords(lang));
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
      // An anonymous visitor: the session double's default principal.
      { provide: AUTH_SESSION_PORTS, useValue: memoryAuthSessionPorts() },
      // The shared header's account circle reads its photo off the
      // session identity — no avatar for an anonymous visitor.
      { provide: AVATAR_PORTS, useValue: memoryAvatarPorts() },
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
      // …and its schedule row names the default location's shop day.
      {
        provide: LOCATION_LOAD_PORTS,
        useValue: memoryLocationLoadPorts(
          memoryProgramsWorld({ locations: [locationFixture()] }),
        ),
      },
      {
        provide: DEFAULT_LOCATION_PORTS,
        useValue: memoryDefaultLocationPorts(),
      },
      // The shell reads the injected clock (the menu's day, the footer's year).
      { provide: CLOCK_PORTS, useValue: memoryClockPorts() },
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

  // OR-53: the stored status is SCREAMING (`UPCOMING`); the badge prints the
  // catalogue's sentence-case word, in today's tone.
  it('badges an upcoming course "Upcoming" with a warning tone', async () => {
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
    expect(badge?.textContent?.trim()).toBe('Upcoming');
    expect(badge?.getAttribute('data-tone')).toBe('warning');
  });

  it('prints the badge text "Open" for an open course', async () => {
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
    expect(badge?.textContent?.trim()).toBe('Open');
  });

  it('prints the badge words in bg, agreeing with «курс» (OR-53)', async () => {
    const fixture = await configure([
      course('course_1', EnrollmentStatus.Open),
      course('course_2', EnrollmentStatus.Upcoming),
    ]);
    // The shell's language service applies its own default when the chrome
    // first creates it, so it is booted first and bg is applied after it.
    TestBed.inject(LanguageService);
    TestBed.inject(TranslocoService).setActiveLang('bg');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    const badge = () =>
      host.querySelector('[data-testid="courses-list"] a[uilistrow] [uibadge]');
    expect(badge()?.textContent?.trim()).toBe('Отворен');

    (
      host.querySelector(
        '[data-testid="courses-tab-upcoming"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    expect(badge()?.textContent?.trim()).toBe('Предстоящ');
  });
});
