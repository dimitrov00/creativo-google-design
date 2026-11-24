import { EnvironmentProviders, Injectable, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import {
  Translation,
  TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type GovernanceCall,
  ImpersonationEndReason,
  ImpersonationScope,
  type ReadAsClaims,
} from '@core/components';
import {
  ImpersonationSessionId,
  Result,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import type { AuthSessionPorts, ReadAsCallPorts } from '@core/ports';
import { ZonedTimeSystem } from '@core/systems';
import { memoryClockPorts, unwrapOk } from '@core/testing';
import {
  AUTH_SESSION_PORTS,
  CLOCK_PORTS,
  READ_AS_CALL_PORTS,
  READ_AS_SESSION_PORTS,
  ShopZoneService,
} from '@creativo/infrastructure/firebase-app';
import { ReadAsBannerComponent } from './read-as-banner.component';

/*
 * The read-as banner (OR-24): drawn only under a read-as token, «Край» ends
 * the session on the server and signs out, and the window's end signs out
 * by itself.
 */

const bg: Translation = {
  shell: {
    readAs: {
      actingAs: 'Действаш като {{name}}',
      someone: 'този профил',
      until: 'до {{time}}',
      end: 'Край',
      label: 'Само за четене',
    },
  },
};

@Injectable()
class TestTranslationLoader implements TranslocoLoader {
  getTranslation(): Observable<Translation> {
    return of(bg);
  }
}

function provideTestI18n(): EnvironmentProviders[] {
  return provideTransloco({
    config: {
      availableLangs: ['bg'],
      defaultLang: 'bg',
      missingHandler: { logMissingKey: false },
    },
    loader: TestTranslationLoader,
  });
}

const NOW = unwrapOk(UtcEpochMs.of(Date.UTC(2026, 10, 24, 10, 20)));
/** 12:32 in Sofia — twelve minutes after `NOW`. */
const EXPIRES = unwrapOk(UtcEpochMs.of(Date.UTC(2026, 10, 24, 10, 32)));
const SESSION = ImpersonationSessionId.of('imp-1');

const READ_AS: ReadAsClaims = {
  readAsSessionId: SESSION,
  readAsByUserId: UserId.of('u-support'),
  readAsScope: ImpersonationScope.Read,
  readAsExpiresAtUtcMs: EXPIRES,
};

async function render(readAs: ReadAsClaims | null) {
  const readAs$ = new BehaviorSubject<ReadAsClaims | null>(readAs);
  const ended: GovernanceCall.End[] = [];
  const signOut = vi.fn(async () => Result.ok(undefined));
  const calls: ReadAsCallPorts = {
    startReadAs: async () =>
      Result.ok({ sessionId: SESSION, customToken: 't' }),
    endReadAs: async (call) => {
      ended.push(call);
      return Result.ok({
        sessionId: call.sessionId,
        impersonationEndReason: ImpersonationEndReason.AdminEnded,
      });
    },
  };
  const auth: Partial<AuthSessionPorts> = {
    signOut,
    currentDisplayName: () => 'Иван Колев',
  };
  await TestBed.configureTestingModule({
    imports: [ReadAsBannerComponent],
    providers: [
      ...provideTestI18n(),
      provideRouter([]),
      { provide: CLOCK_PORTS, useValue: memoryClockPorts(NOW) },
      { provide: AUTH_SESSION_PORTS, useValue: auth },
      { provide: READ_AS_CALL_PORTS, useValue: calls },
      {
        provide: READ_AS_SESSION_PORTS,
        useValue: {
          observeReadAs: () => readAs$,
          signInWithReadAsToken: async () => Result.ok(undefined),
        },
      },
      {
        provide: ShopZoneService,
        useValue: {
          defaultZone: () =>
            signal(unwrapOk(ZonedTimeSystem.checkZone('Europe/Sofia'))),
        },
      },
    ],
  }).compileComponents();
  const navigate = vi
    .spyOn(TestBed.inject(Router), 'navigateByUrl')
    .mockResolvedValue(true);
  const fixture: ComponentFixture<ReadAsBannerComponent> =
    TestBed.createComponent(ReadAsBannerComponent);
  for (let pass = 0; pass < 3; pass++) {
    fixture.detectChanges();
    await fixture.whenStable();
  }
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    ended,
    signOut,
    navigate,
    readAs$,
  };
}

describe('ReadAsBannerComponent', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('draws nothing on a plain session', async () => {
    const { host } = await render(null);
    expect(host.querySelector('[data-testid="read-as-banner"]')).toBeNull();
  });

  it('says whose eyes these are and until when — a status, named «Само за четене»', async () => {
    const { host } = await render(READ_AS);
    const banner = host.querySelector('[data-testid="read-as-banner"]');
    expect(banner?.getAttribute('role')).toBe('status');
    expect(banner?.getAttribute('aria-label')).toBe('Само за четене');
    expect(
      host.querySelector('[data-testid="read-as-title"]')?.textContent?.trim(),
    ).toBe('Действаш като Иван Колев');
    expect(
      host.querySelector('[data-testid="read-as-until"]')?.textContent?.trim(),
    ).toBe('до 12:32');
  });

  it('«Край» ends the session on the server, then signs out and opens the sign-in', async () => {
    const { fixture, host, ended, signOut, navigate } = await render(READ_AS);
    host
      .querySelector<HTMLButtonElement>('[data-testid="read-as-end"]')
      ?.click();
    await fixture.whenStable();
    expect(ended).toEqual([{ sessionId: SESSION }]);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/auth');
  });

  it('signs out by itself the moment the window ends', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { fixture, signOut, navigate } = await render(READ_AS);
    expect(signOut).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(12 * 60_000);
    await fixture.whenStable();
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/auth');
  });
});
