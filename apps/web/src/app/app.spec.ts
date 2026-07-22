import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { EnvironmentProviders, Injectable } from '@angular/core';
import {
  Translation,
  TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import { AUTH_GATEWAY } from '@creativo/application/identity';
import { PROFILE_PORT } from '@creativo/application/accounts';
import { FIREBASE_AUTH } from '@creativo/infrastructure/firebase-app';
import { ok } from '@creativo/domain/kernel';
import { ANONYMOUS_PRINCIPAL } from '@creativo/domain/identity';
import { App } from './app';

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

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
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
          provide: PROFILE_PORT,
          useValue: {
            getProfile: () => Promise.resolve(ok(null)),
            saveProfile: () => Promise.resolve(ok(undefined)),
          },
        },
        // E2eSignInHookService (only wired in dev mode, which TestBed runs
        // under) injects FIREBASE_AUTH just to stash a window hook — never
        // called in this spec, so an opaque stand-in is enough.
        { provide: FIREBASE_AUTH, useValue: {} },
      ],
    }).compileComponents();
  });

  it('mounts the router outlet', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement;

    expect(host.querySelector('router-outlet')).not.toBeNull();
  });
});
