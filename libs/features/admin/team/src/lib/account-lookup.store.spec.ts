import { TestBed } from '@angular/core/testing';
import type { User } from '@core/entities';
import { RepositoryError } from '@core/errors';
import type { UserSearchPorts } from '@core/ports';
import { Result, UserId } from '@core/primitives';
import { userFixture } from '@core/testing';
import {
  AUTH_DEPLOYMENT_PORTS,
  USER_SEARCH_PORTS,
} from '@creativo/infrastructure/firebase-app';
import { AccountLookupStore } from './account-lookup.store';

/*
 * `AccountLookupStore`: what was typed, asked of the accounts' index once
 * the typing rests — over a scripted index and the test's own clock.
 */

const GEORGI = userFixture({ id: UserId.of('u-georgi') });
const ANA = userFixture({ id: UserId.of('u-ana') });

type Answer = Result<readonly User[], RepositoryError>;

function harness() {
  const asked: string[] = [];
  /** One answer per question, in the order they were asked; held until told. */
  const pending: ((answer: Answer) => void)[] = [];
  const search: UserSearchPorts = {
    searchUsers: (prefix) => {
      asked.push(prefix);
      return new Promise<Answer>((resolve) => pending.push(resolve));
    },
  };
  TestBed.configureTestingModule({
    providers: [
      AccountLookupStore,
      { provide: USER_SEARCH_PORTS, useValue: search },
      {
        provide: AUTH_DEPLOYMENT_PORTS,
        useValue: { authDeployment: { defaultCountry: 'BG' } },
      },
    ],
  });
  const store = TestBed.inject(AccountLookupStore);
  /** The typing rests: the debounce runs out. */
  const rest = () => vi.advanceTimersByTimeAsync(300);
  /** The index answers its `index`-th question. */
  const answer = async (index: number, value: Answer): Promise<void> => {
    pending.at(index)?.(value);
    await vi.advanceTimersByTimeAsync(0);
  };
  return { store, asked, rest, answer };
}

describe('AccountLookupStore — the lookup of «Свържи профил»', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('asks nothing for nothing typed, or for blanks alone', async () => {
    const { store, asked, rest } = harness();
    store.ask('');
    store.ask('   ');
    await rest();

    expect(asked).toEqual([]);
    expect(store.asked()).toBe(false);
    expect(store.searching()).toBe(false);
    expect(store.accounts()).toEqual([]);
  });

  it('asks once the typing rests: a typed name is one question, in the index’s own form', async () => {
    const { store, asked, rest, answer } = harness();
    store.ask('Гео');
    store.ask('Геор');
    store.ask('Георги');
    expect(store.asked()).toBe(true);
    expect(store.searching()).toBe(true);
    expect(asked).toEqual([]);

    await rest();
    expect(asked).toEqual(['георги']);

    await answer(0, Result.ok([GEORGI]));
    expect(store.accounts()).toEqual([GEORGI]);
    expect(store.searching()).toBe(false);
    expect(store.failed()).toBe(false);
  });

  it('asks a phone in every form it is said, and lists an account found twice once', async () => {
    const { store, asked, rest, answer } = harness();
    store.ask('0881 112 233');
    await rest();

    expect(asked.length).toBeGreaterThan(1);
    for (let index = 0; index < asked.length; index++) {
      await answer(index, Result.ok(index === 0 ? [GEORGI, ANA] : [GEORGI]));
    }
    expect(store.accounts()).toEqual([GEORGI, ANA]);
  });

  it('an answer that comes back late never replaces the answer to a newer query', async () => {
    const { store, rest, answer } = harness();
    store.ask('Георги');
    await rest();
    store.ask('Ана Колева');
    await rest();

    await answer(1, Result.ok([ANA]));
    await answer(0, Result.ok([GEORGI]));

    expect(store.accounts()).toEqual([ANA]);
    expect(store.searching()).toBe(false);
  });

  it('says a lookup the index could not read at all failed', async () => {
    const { store, rest, answer } = harness();
    store.ask('Георги');
    await rest();
    await answer(0, Result.err(RepositoryError.readFailed(null, null)));

    expect(store.failed()).toBe(true);
    expect(store.accounts()).toEqual([]);
    expect(store.searching()).toBe(false);
  });

  it('a cleared field drops the lookup in force and what it found', async () => {
    const { store, rest, answer } = harness();
    store.ask('Георги');
    await rest();
    await answer(0, Result.ok([GEORGI]));

    store.ask('');

    expect(store.asked()).toBe(false);
    expect(store.accounts()).toEqual([]);
  });
});
