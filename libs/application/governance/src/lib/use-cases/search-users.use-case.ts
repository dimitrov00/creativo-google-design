import { Result, fail, ok } from '@creativo/domain/kernel';
import { UserSearchPort, UserSearchResult } from '../ports/user-search.port';
import {
  SearchQueryTooShortError,
  SearchUsersError,
  SearchUsersRepositoryFailure,
} from './search-users.errors';

export const MIN_QUERY_LENGTH = 2;

/** Rejects a too-short admin search query before it ever reaches the (potentially expensive) search adapter. */
export class SearchUsersUseCase {
  constructor(private readonly userSearch: UserSearchPort) {}

  async execute(
    rawQuery: string,
  ): Promise<Result<readonly UserSearchResult[], SearchUsersError>> {
    const query = rawQuery.trim();
    if (query.length < MIN_QUERY_LENGTH) {
      return fail(new SearchQueryTooShortError(MIN_QUERY_LENGTH));
    }

    const result = await this.userSearch.search(query);
    if (result.isFailure()) {
      return fail(new SearchUsersRepositoryFailure(result.error));
    }

    return ok(result.value);
  }
}
