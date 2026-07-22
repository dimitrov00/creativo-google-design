import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EnvironmentProviders, Injectable } from '@angular/core';
import {
  Translation,
  TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import { AUTH_GATEWAY, OTP_CLIENT, ok } from '@creativo/application/identity';
import { CATALOG_READER } from '@creativo/application/catalog';
import { FIREBASE_AUTH } from '@creativo/infrastructure/firebase-app';
import { ClientOnboarding } from './client-onboarding';

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
      defaultLang: 'bg',
      fallbackLang: 'bg',
      missingHandler: { logMissingKey: false },
    },
    loader: TestTranslationLoader,
  });
}

describe('ClientOnboarding', () => {
  let component: ClientOnboarding;
  let fixture: ComponentFixture<ClientOnboarding>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ClientOnboarding],
      providers: [
        provideRouter([]),
        ...provideTestI18n(),
        {
          provide: AUTH_GATEWAY,
          useValue: {
            observePrincipal: () =>
              of({ kind: 'onboarding', uid: { value: 'uid_1' } }),
            refreshToken: () => Promise.resolve(ok(undefined)),
            signOut: () => Promise.resolve(ok(undefined)),
          },
        },
        {
          provide: OTP_CLIENT,
          useValue: {
            requestChallenge: () => Promise.resolve(ok('challenge_1')),
            verifyChallenge: () =>
              Promise.resolve(ok({ kind: 'returning' as const })),
            completeRegistration: () => Promise.resolve(ok(undefined)),
          },
        },
        {
          provide: CATALOG_READER,
          useValue: {
            listActiveServices: () => of(ok([])),
            findServiceById: () => Promise.resolve(ok(null)),
            listServiceCategories: () => of(ok([])),
            listActiveBarbers: () => of(ok([])),
            findBarberById: () => Promise.resolve(ok(null)),
            listActiveLocations: () => of(ok([])),
            findLocationById: () => Promise.resolve(ok(null)),
          },
        },
        {
          provide: FIREBASE_AUTH,
          useValue: { currentUser: { phoneNumber: '+15550001234' } },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ClientOnboarding);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create and start on the about step', () => {
    expect(component).toBeTruthy();
    const host: HTMLElement = fixture.nativeElement;
    expect(
      host.querySelector('[data-testid="onboarding-about"]'),
    ).not.toBeNull();
  });
});
