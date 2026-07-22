import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import {
  ANONYMOUS_PRINCIPAL,
  AUTH_GATEWAY,
  PrincipalId,
  Result,
  activePrincipal,
  ok,
  roleFromPrimitive,
} from '@creativo/application/identity';
import {
  PROFILE_PORT,
  User,
  ZonedDateTime,
} from '@creativo/application/accounts';
import { AccountStateService } from './account-state.service';

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

const TODAY = unwrap(ZonedDateTime.fromISO('2026-01-01T00:00:00.000Z', 'UTC'));
const PRINCIPAL_ID = unwrap(PrincipalId.create('user_1'));
const PRINCIPAL = unwrap(
  activePrincipal(PRINCIPAL_ID, [roleFromPrimitive('client')]),
);

function user(): User {
  return unwrap(
    User.create(
      {
        id: 'user_1',
        phone: '+359881234567',
        firstName: 'Jane',
        lastName: 'Doe',
        roles: ['client'],
        status: { kind: 'active' },
      },
      TODAY,
    ),
  );
}

describe('AccountStateService', () => {
  it('clears the account and loading flag for an anonymous principal', async () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AUTH_GATEWAY,
          useValue: { observePrincipal: () => of(ANONYMOUS_PRINCIPAL) },
        },
        {
          provide: PROFILE_PORT,
          useValue: { getProfile: () => Promise.resolve(ok(null)) },
        },
      ],
    });

    const service = TestBed.inject(AccountStateService);
    TestBed.tick();
    await Promise.resolve();

    expect(service.account()).toBeNull();
    expect(service.accountLoading()).toBe(false);
  });

  it('fetches once per signed-in uid and reflects loading while in flight', async () => {
    let resolveProfile: (result: Result<User | null, never>) => void = () =>
      undefined;
    const profile = new Promise<Result<User | null, never>>((resolve) => {
      resolveProfile = resolve;
    });

    TestBed.configureTestingModule({
      providers: [
        {
          provide: AUTH_GATEWAY,
          useValue: { observePrincipal: () => of(PRINCIPAL) },
        },
        { provide: PROFILE_PORT, useValue: { getProfile: () => profile } },
      ],
    });

    const service = TestBed.inject(AccountStateService);
    TestBed.tick();
    await Promise.resolve();
    expect(service.accountLoading()).toBe(true);
    expect(service.account()).toBeNull();

    resolveProfile(ok(user()));
    await profile;
    TestBed.tick();
    await Promise.resolve();

    expect(service.accountLoading()).toBe(false);
    expect(service.account()?.fullName()).toBe('Jane Doe');
  });
});
