import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EnvironmentProviders, Injectable } from '@angular/core';
import {
  Translation,
  TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import {
  AUTH_GATEWAY,
  ANONYMOUS_PRINCIPAL,
  OTP_CLIENT,
  ok,
} from '@creativo/application/identity';
import { ClientAuth } from './client-auth';

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

describe('ClientAuth', () => {
  let component: ClientAuth;
  let fixture: ComponentFixture<ClientAuth>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ClientAuth],
      providers: [
        provideRouter([]),
        ...provideTestI18n(),
        {
          provide: AUTH_GATEWAY,
          useValue: {
            observePrincipal: () => of(ANONYMOUS_PRINCIPAL),
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
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ClientAuth);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create and start on the welcome step', () => {
    expect(component).toBeTruthy();
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('[data-testid="auth-welcome"]')).not.toBeNull();
  });

  it('walks welcome → identify on "get started"', async () => {
    const host: HTMLElement = fixture.nativeElement;
    host
      .querySelector<HTMLButtonElement>('[data-testid="auth-get-started"]')
      ?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(host.querySelector('[data-testid="auth-identify"]')).not.toBeNull();
  });
});
