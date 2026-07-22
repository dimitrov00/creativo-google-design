import { describe, expect, it } from 'vitest';
import { Result, ok } from '@creativo/domain/kernel';
import { RepositoryError } from '@creativo/application/shared';
import { UserSearchPort, UserSearchResult } from '../ports/user-search.port';
import { SearchUsersUseCase } from './search-users.use-case';
import { SearchQueryTooShortError } from './search-users.errors';

function fakeUserSearch(results: readonly UserSearchResult[]): UserSearchPort {
  return {
    async search(): Promise<
      Result<readonly UserSearchResult[], RepositoryError>
    > {
      return ok(results);
    },
  };
}

describe('SearchUsersUseCase', () => {
  it('forwards a valid query to the search port', async () => {
    const useCase = new SearchUsersUseCase(fakeUserSearch([]));

    const result = await useCase.execute('jane');

    expect(result.isSuccess()).toBe(true);
  });

  it('rejects a too-short query without calling the port', async () => {
    let called = false;
    const port: UserSearchPort = {
      async search() {
        called = true;
        return ok([]);
      },
    };
    const useCase = new SearchUsersUseCase(port);

    const result = await useCase.execute('j');

    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(SearchQueryTooShortError);
    }
    expect(called).toBe(false);
  });
});
